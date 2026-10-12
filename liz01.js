// ============================================================
// liz01.js — 荔枝短剧 (https://liz01.com) 适配脚本
// 站点类型：Nuxt SSR + 开放 JSON API，无需登录、无算力验证
// 接口：
//   GET /api/v1/category/tree          分类树
//   GET /api/v1/drama/list?page=&categoryId=  列表
//   GET /api/v1/drama/{id}             剧详情
//   GET /api/v1/drama/{id}/episodes    剧集列表
//   GET /api/v1/search?keyword=&page=  搜索
//   播放页 /drama/{id}/ep-{n} HTML 内嵌 contentUrl（m3u8 带 sign，实时提取）
// 导出格式：export default（默影视魔改版要求）
// ============================================================
// v2 优化：查表法 AES 加速 + 密钥扩展缓存 + 解密结果缓存 + 按魔数返回 mime
// ============================================================

var SITE = "https://liz01.com";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var REF = SITE + "/";

function headers() {
  return { "User-Agent": UA, "Referer": REF, "Accept": "*/*" };
}

// 带重试的 GET，返回 content 文本
function get(url, retry) {
  retry = retry === undefined ? 3 : retry;
  var err = null;
  for (var i = 0; i < retry; i++) {
    try {
      var r = req(url, { method: "GET", headers: headers() });
      if (r && r.code === 200 && r.content) return r.content;
      if (r && r.content) return r.content;
      err = new Error("http " + (r ? r.code : "null") + " " + url);
    } catch (e) {
      err = e;
    }
  }
  throw err || new Error("req fail " + url);
}

function getJson(url) {
  var txt = get(url);
  return JSON.parse(txt);
}

// ============ 封面解密（AES-128-CBC）============
// 源站封面为 AES 加密二进制（WebP/JPEG），密钥/IV 提取自首页 __NUXT__：
//   imageAesKeyHex="ea19c21e85d768da4165f5964ab886b2"
//   imageAesIvHex="f4d53ecbc273901e0d9cd7848233c702"
// 方案：列表/详情只返回本机 /proxy 代理 URL，App 按需请求时脚本下载密文、
//       解密为明文 base64，经引擎 proxy1 协议（[code,mime,b64,{},1]）回传图片流。
// v2：AES 逆列混合用预计算乘法表（替代逐位 gfMul），密钥扩展只算一次；
//     解密结果按 URL 缓存（App 重复请求/刷新直接命中秒回）；
//     按明文魔数返回正确 mime（WebP/JPEG/PNG/GIF），修复 JPEG 封面无法解码的问题。

var _B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function _hexToBytes(h) {
  var out = [];
  for (var i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
  return out;
}

function _b64ToBytes(s) {
  var out = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === "=") break;
    var idx = _B64.indexOf(c);
    if (idx < 0) continue;
    buf = (buf << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

function _bytesToB64(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
    var n = (b0 << 16) | ((b1 >= 0 ? b1 : 0) << 8) | (b2 >= 0 ? b2 : 0);
    out += _B64.charAt((n >> 18) & 63) + _B64.charAt((n >> 12) & 63);
    out += b1 >= 0 ? _B64.charAt((n >> 6) & 63) : "=";
    out += b2 >= 0 ? _B64.charAt(n & 63) : "=";
  }
  return out;
}

var _SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _INV_SBOX = []; for (var _i = 0; _i < 256; _i++) _INV_SBOX[_SBOX[_i]] = _i;
var _RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

// ---- v2 预计算：GF(2^8) 乘法表（逆列混合系数 0e/0b/0d/09）----
var _MUL_0E = [], _MUL_0B = [], _MUL_0D = [], _MUL_09 = [];
(function () {
  function _gfMulOnce(a, b) {
    var res = 0;
    while (b) {
      if (b & 1) res ^= a;
      a <<= 1;
      if (a & 0x100) a ^= 0x11b;
      b >>= 1;
    }
    return res;
  }
  for (var _x = 0; _x < 256; _x++) {
    _MUL_0E.push(_gfMulOnce(_x, 0x0e));
    _MUL_0B.push(_gfMulOnce(_x, 0x0b));
    _MUL_0D.push(_gfMulOnce(_x, 0x0d));
    _MUL_09.push(_gfMulOnce(_x, 0x09));
  }
})();

// ---- v2 密钥扩展只执行一次（密钥固定）----
var _KEY_BYTES = _hexToBytes("ea19c21e85d768da4165f5964ab886b2");
var _IV_BYTES = _hexToBytes("f4d53ecbc273901e0d9cd7848233c702");
var _EXPANDED_KEY = (function () {
  var key = _KEY_BYTES.slice();
  var w = key.slice();
  for (var wi = 4; wi < 44; wi++) {
    var base = 4 * wi;
    if (wi % 4 === 0) {
      var t0 = _SBOX[w[base - 3]], t1 = _SBOX[w[base - 2]], t2 = _SBOX[w[base - 1]], t3 = _SBOX[w[base - 4]];
      t0 ^= _RCON[wi / 4 - 1];
      w.push(w[base - 16] ^ t0, w[base - 15] ^ t1, w[base - 14] ^ t2, w[base - 13] ^ t3);
    } else {
      w.push(w[base - 4] ^ w[base - 16], w[base - 3] ^ w[base - 15], w[base - 2] ^ w[base - 14], w[base - 1] ^ w[base - 13]);
    }
  }
  return w;
})();

// ---- v2 查表法 AES 解密轮（替代逐位 gfMul）----
function _aesDecryptBlock(state, w) {
  var r, c, rw, j;
  function addRoundKey(s, rnd) {
    for (c = 0; c < 4; c++) for (rw = 0; rw < 4; rw++) s[rw + 4 * c] ^= w[rnd * 16 + rw + 4 * c];
  }
  addRoundKey(state, 10);
  for (r = 9; r >= 0; r--) {
    var out = state.slice();
    out[1] = state[13]; out[5] = state[1]; out[9] = state[5]; out[13] = state[9];
    out[2] = state[10]; out[6] = state[14]; out[10] = state[2]; out[14] = state[6];
    out[3] = state[7];  out[7] = state[11]; out[11] = state[15]; out[15] = state[3];
    state = out;
    for (j = 0; j < 16; j++) state[j] = _INV_SBOX[state[j]];
    addRoundKey(state, r);
    if (r > 0) {
      for (c = 0; c < 4; c++) {
        var a0 = state[4 * c], a1 = state[4 * c + 1], a2 = state[4 * c + 2], a3 = state[4 * c + 3];
        state[4 * c]     = _MUL_0E[a0] ^ _MUL_0B[a1] ^ _MUL_0D[a2] ^ _MUL_09[a3];
        state[4 * c + 1] = _MUL_09[a0] ^ _MUL_0E[a1] ^ _MUL_0B[a2] ^ _MUL_0D[a3];
        state[4 * c + 2] = _MUL_0D[a0] ^ _MUL_09[a1] ^ _MUL_0E[a2] ^ _MUL_0B[a3];
        state[4 * c + 3] = _MUL_0B[a0] ^ _MUL_0D[a1] ^ _MUL_09[a2] ^ _MUL_0E[a3];
      }
    }
  }
  return state;
}

function _aesCbcDecrypt(ct, keyBytes, ivBytes) {
  var w = _EXPANDED_KEY;
  var prev = ivBytes.slice();
  var out = [];
  for (var off = 0; off < ct.length; off += 16) {
    var block = ct.slice(off, off + 16);
    var dec = _aesDecryptBlock(block.slice(), w);
    for (var i = 0; i < 16; i++) out.push(dec[i] ^ prev[i]);
    prev = block;
  }
  return out;
}

// 明文魔数 -> mime（修复 JPEG/PNG 封面被统一标成 webp 后无法解码的问题）
function _mimeOf(plain) {
  if (plain.length >= 4 && plain[0] === 0x52 && plain[1] === 0x49 && plain[2] === 0x46 && plain[3] === 0x46) return "image/webp"; // RIFF
  if (plain.length >= 2 && plain[0] === 0xff && plain[1] === 0xd8) return "image/jpeg";
  if (plain.length >= 4 && plain[0] === 0x89 && plain[1] === 0x50 && plain[2] === 0x4e && plain[3] === 0x47) return "image/png";
  if (plain.length >= 4 && plain[0] === 0x47 && plain[1] === 0x49 && plain[2] === 0x46 && plain[3] === 0x38) return "image/gif";
  return "application/octet-stream";
}

// 密文 base64 -> {mime, b64}（失败返回 null）
function _decryptCoverB64(b64) {
  try {
    var ct = _b64ToBytes(b64);
    if (!ct.length || ct.length % 16 !== 0) return null;
    var pt = _aesCbcDecrypt(ct, _KEY_BYTES, _IV_BYTES);
    var pad = pt[pt.length - 1];
    if (pad < 1 || pad > 16) return null;
    for (var j = 0; j < pad; j++) if (pt[pt.length - pad + j] !== pad) return null;
    var plain = pt.slice(0, pt.length - pad);
    return { mime: _mimeOf(plain), b64: _bytesToB64(plain) };
  } catch (e) {
    return null;
  }
}

// ---- v2 解密结果缓存（URL -> {mime,b64}，最多保留 300 条，LRU 近似：满时整体清空）----
var _coverCache = {};
var _COVER_CACHE_MAX = 300;
var _coverCacheCount = 0;

function _decryptCover(url) {
  var hit = _coverCache[url];
  if (hit) return hit;
  try {
    var r = req(url, { method: "GET", headers: headers(), buffer: 2 });
    var b64 = (r && typeof r === "object" && r.content) ? r.content : (typeof r === "string" ? r : "");
    if (!b64) return null;
    var got = _decryptCoverB64(b64);
    if (!got) return null;
    _coverCache[url] = got;
    _coverCacheCount++;
    if (_coverCacheCount > _COVER_CACHE_MAX) {
      _coverCache = {};
      _coverCacheCount = 0;
      _coverCache[url] = got;
      _coverCacheCount = 1;
    }
    return got;
  } catch (e) {
    return null;
  }
}

// 生成指向本机 /proxy 的封面代理 URL（App 按需请求，脚本内解密后回传明文图片）
function _pic(url) {
  if (!url) return "";
  if (url.indexOf("http") !== 0) return url;
  return getProxy(true).replace("do=js", "do=pic") + "&siteKey=liz01&url=" + encodeURIComponent(url);
}

// 引擎 proxy 入口：下载密文 -> AES-128-CBC 解密 -> 返回 [code, mime, b64, headers, 1]
function proxy(params) {
  try {
    var url = (params && params.url) || "";
    if (!url) return [404, "text/plain", "no url", {}, 0];
    var got = _decryptCover(url);
    if (!got) return [404, "text/plain", "decrypt fail", {}, 0];
    return [200, got.mime, got.b64, {}, 1];
  } catch (e) {
    return [404, "text/plain", "proxy error", {}, 0];
  }
}

// ============ 数据映射 ============

// 列表映射：vod_pic 返回本机 /proxy 代理 URL（App 按需下载解密，避免透传密文空白）
function mapVod(items) {
  var out = [];
  if (!items || !items.length) return out;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var remarks = "";
    if (it.totalEpisodes) remarks = String(it.totalEpisodes) + "集";
    if (it.displayViewText) remarks = (remarks ? remarks + "·" : "") + it.displayViewText;
    out.push({
      vod_id: String(it.id),
      vod_name: it.title || "",
      vod_pic: _pic(it.coverUrl || ""),
      vod_remarks: remarks
    });
  }
  return out;
}

function buildClass() {
  var j = getJson(SITE + "/api/v1/category/tree");
  var arr = (j && j.data) || [];
  var cls = [];
  function flat(nodes) {
    if (!nodes) return;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      cls.push({ type_id: String(n.id), type_name: n.categoryName || "" });
      if (n.children && n.children.length) flat(n.children);
    }
  }
  flat(arr);
  return cls;
}

// ============ spider ============

var _spider = {
  // 分类
  init: function () {
    var cls = [];
    try { cls = buildClass(); } catch (e) {}
    return JSON.stringify({ class: cls });
  },

  // 首页
  home: function (filter) {
    var cls = [];
    var list = [];
    try { cls = buildClass(); } catch (e) {}
    try {
      var j = getJson(SITE + "/api/v1/drama/list?page=1");
      list = mapVod(j.data.page.items);
    } catch (e) {}
    return JSON.stringify({ class: cls, list: list });
  },

  // 首页推荐
  homeVod: function () {
    var list = [];
    try {
      var j = getJson(SITE + "/api/v1/drama/list?page=1");
      list = mapVod(j.data.page.items);
    } catch (e) {}
    return JSON.stringify({ list: list });
  },

  // 分类
  category: function (tid, pg, filter, extend) {
    var page = pg || 1;
    var cls = [];
    var list = [];
    var pagecount = page;
    try { cls = buildClass(); } catch (e) {}
    try {
      var j = getJson(SITE + "/api/v1/drama/list?page=" + page + "&categoryId=" + tid);
      var p = j.data.page;
      list = mapVod(p.items);
      if (p.total && p.size) {
        pagecount = Math.ceil(p.total / p.size);
      } else if (p.hasMore) {
        pagecount = page + 1;
      }
    } catch (e) {}
    return JSON.stringify({ class: cls, list: list, page: page, pagecount: pagecount });
  },

  // 详情
  detail: function (id) {
    var d = getJson(SITE + "/api/v1/drama/" + id);
    var data = d.data;
    var eps = [];
    try {
      var e = getJson(SITE + "/api/v1/drama/" + id + "/episodes");
      eps = e.data || [];
    } catch (err) {}

    var playFrom = ["荔枝"];
    var playUrls = [];
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      var name = ep.title || ("第" + ep.epNo + "集");
      var url = SITE + "/drama/" + id + "/ep-" + ep.epNo + "/";
      playUrls.push(name + "$" + url);
    }
    var playUrl = playUrls.join("#");

    var vod = {
      vod_id: String(id),
      vod_name: data.title || "",
      vod_pic: _pic(data.coverUrl || ""),
      vod_content: data.description || "",
      vod_play_from: playFrom.join("$$$"),
      vod_play_url: playUrl
    };
    return JSON.stringify({ list: [vod] });
  },

  // 搜索
  search: function (key, quick, pg) {
    var page = pg || 1;
    var list = [];
    try {
      var j = getJson(SITE + "/api/v1/search?keyword=" + encodeURIComponent(key) + "&page=" + page);
      list = mapVod(j.data.result.page.items);
    } catch (e) {}
    return JSON.stringify({ list: list });
  },

  // 播放：请求播放页 HTML，正则提取内嵌 contentUrl（m3u8 带签名，实时）
  play: function (flag, id) {
    var html = get(id);
    var m = html.match(/\/api\/v1\/cdn\/[a-z]+\/[a-zA-Z0-9-]+\/manifest\.m3u8\?[^"'\\\s]+/);
    if (!m) {
      // 301 跳转兜底：无尾斜杠时补斜杠再试
      if (id.charAt(id.length - 1) !== "/") {
        html = get(id + "/");
        m = html.match(/\/api\/v1\/cdn\/[a-z]+\/[a-zA-Z0-9-]+\/manifest\.m3u8\?[^"'\\\s]+/);
      }
    }
    if (!m) return JSON.stringify({ parse: 0, url: "", msg: "未找到播放地址" });
    var url = SITE + m[0];
    return JSON.stringify({
      parse: 0,
      url: url,
      header: { "User-Agent": UA, "Referer": REF },
      format: "application/x-mpegURL"
    });
  },

  // 封面代理：下载密文 -> AES-CBC 解密 -> 明文图片流
  proxy: proxy
};

export default _spider;
