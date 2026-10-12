// ============================================================
// airav.js — 瘋AV (AirAv) 适配脚本
// 站点入口：https://airavplus12.cc （会跳转），主域 https://airav.io
// 两个域名指向同一站点（免費A片-瘋AV），airavplus12.cc 直连稳定，airav.io 作兜底
// 特性：静态 HTML 页面，无登录、无验证码、无 JS 算力门槛
// 接口：
//   首页      GET /                          （卡片列表）
//   分类      GET /list?sort=<id>&page=<n>   sort: 1最近加入 2最新發行 3今日熱門 4本周熱門 5本月熱門
//   标签      GET /tag?id=<id>&page=<n>
//   搜索      GET /search_result?kw=<词>&page=<n>
//   详情      GET /video?hid=<hid>           （标题/封面/番號/女優/標籤）
//   播放      GET /embedded?hid=<hid>        HTML 内嵌 var videoUrl = "...m3u8"（实时签名）
// 导出格式：export default（默影视魔改版要求）
// ============================================================

var SITE = "https://airavplus12.cc";
var ALT = "https://airav.io";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function headers() {
  return { "User-Agent": UA, "Referer": SITE + "/", "Accept": "*/*" };
}

// 带域名兜底 + 重试的 GET，返回 content 文本
function get(url, retry) {
  retry = retry === undefined ? 2 : retry;
  var hosts = [SITE, ALT];
  var lastErr = null;
  for (var h = 0; h < hosts.length; h++) {
    var u = url;
    // 相对路径补域名
    if (u.indexOf("http") !== 0) u = hosts[h] + u;
    else if (u.indexOf(SITE) === 0) u = hosts[h] + u.substring(SITE.length);
    for (var i = 0; i < retry; i++) {
      try {
        var r = req(u, { method: "GET", headers: headers() });
        if (r && r.code === 200 && r.content) return r.content;
        if (r && r.content) return r.content;
        lastErr = new Error("http " + (r ? r.code : "null") + " " + u);
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error("req fail " + url);
}

// ============ HTML 解析 ============

function stripTags(s) {
  return s ? s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
}

// 列表页解析：返回 [{vod_id, vod_name, vod_pic}]
function parseList(html) {
  var out = [];
  // 卡片 = <a href="/video?hid=XXX" ...>...</a>
  var re = /<a[^>]*href="[^"]*\/video\?hid=([^"&]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = re.exec(html))) {
    var hid = m[0];
    var body = m[2];
    var hid2 = m[1];
    var title = "";
    var pic = "";
    var t = body.match(/alt="([^"]*)"/);
    if (t) title = t[1];
    var p = body.match(/<img[^>]*src="([^"]+)"/);
    if (p) pic = p[1];
    if (!title) {
      var h = body.match(/title="([^"]*)"/);
      if (h) title = h[1];
    }
    if (!title) continue;
    // 封面清理时间戳参数，横图转竖图
    pic = pic.split("?")[0];
    pic = pic.replace("/storage/cover/big/", "/storage/cover/small/");
    if (pic.indexOf("http") !== 0) pic = SITE + pic;
    out.push({
      vod_id: hid2,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: ""
    });
  }
  return out;
}

// 详情页标题
function parseTitle(html) {
  var m = html.match(/<h1>([\s\S]*?)<\/h1>/);
  if (m) return stripTags(m[1]);
  m = html.match(/<meta property="og:title" content="([^"]*)"/);
  if (m) return m[1].replace(/\s*-\s*airav\.io\s*$/, "").trim();
  return "";
}

function parseCover(html) {
  var m = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (m) return m[1].replace("/storage/cover/big/", "/storage/cover/small/").split("?")[0];
  m = html.match(/\/storage\/cover\/small\/([^"'\s]+?\.jpg)/);
  if (m) return SITE + m[0];
  return "";
}

function parseContent(html) {
  var m = html.match(/<meta property="og:description" content="([^"]*)"/);
  if (m) return m[1];
  return "";
}

// ============ 分类 ============

var _classes = [
  { type_id: "s1", type_name: "最近加入" },
  { type_id: "s2", type_name: "最新發行" },
  { type_id: "s3", type_name: "今日熱門" },
  { type_id: "s4", type_name: "本周熱門" },
  { type_id: "s5", type_name: "本月熱門" },
  { type_id: "t81", type_name: "VR" },
  { type_id: "t9", type_name: "人妻" },
  { type_id: "t55", type_name: "美少女" },
  { type_id: "t146", type_name: "學生妹" },
  { type_id: "t15", type_name: "中出" },
  { type_id: "t1", type_name: "巨乳" },
  { type_id: "t10", type_name: "泳裝" }
];

function buildClass() {
  return _classes;
}

// tid -> 列表 URL（s=sort 分类，t=tag 标签）
function classUrl(tid, pg) {
  var p = pg || 1;
  if (tid && tid.charAt(0) === "t") {
    return "/tag?id=" + tid.substring(1) + "&page=" + p;
  }
  var s = (tid && tid.charAt(0) === "s") ? tid.substring(1) : "1";
  return "/list?sort=" + s + "&page=" + p;
}

// ============ spider ============

var _spider = {
  init: function () {
    return JSON.stringify({ class: buildClass() });
  },

  home: function (filter) {
    var list = [];
    try { list = parseList(get("/")); } catch (e) {}
    return JSON.stringify({ class: buildClass(), list: list });
  },

  homeVod: function () {
    var list = [];
    try { list = parseList(get("/list?sort=2&page=1")); } catch (e) {}
    return JSON.stringify({ list: list });
  },

  category: function (tid, pg, filter, extend) {
    var page = pg || 1;
    var list = [];
    var pagecount = page;
    try {
      list = parseList(get(classUrl(tid, page)));
      // 站点无总页数标记，按需增量翻页
      pagecount = page + 1;
    } catch (e) {}
    return JSON.stringify({ class: buildClass(), list: list, page: page, pagecount: pagecount });
  },

  detail: function (id) {
    var hid = id;
    var m = String(id).match(/hid=([^&]+)/);
    if (m) hid = m[1];
    var html = get("/video?hid=" + encodeURIComponent(hid));
    var vod = {
      vod_id: String(hid),
      vod_name: parseTitle(html),
      vod_pic: parseCover(html),
      vod_content: parseContent(html),
      vod_play_from: "AirAv",
      vod_play_url: "AirAv$" + SITE + "/video?hid=" + encodeURIComponent(hid)
    };
    // 番號/女優/標籤 补充进简介
    var extra = [];
    var n = html.match(/番號：<span>([^<]+)<\/span>/);
    if (n) extra.push("番號：" + n[1]);
    var a = html.match(/女優：([\s\S]*?)<\/li>/);
    if (a) {
      var names = a[1].match(/>([^<>]+?)<\/a>/g);
      if (names) {
        var ns = [];
        for (var i = 0; i < names.length; i++) ns.push(stripTags(names[i]));
        extra.push("女優：" + ns.join("、"));
      }
    }
    var tg = html.match(/標籤：([\s\S]*?)<\/li>/);
    if (tg) {
      var tags = tg[1].match(/>([^<>]+?)<\/a>/g);
      if (tags) {
        var ts = [];
        for (var j = 0; j < tags.length; j++) ts.push(stripTags(tags[j]));
        extra.push("標籤：" + ts.join("、"));
      }
    }
    if (extra.length) vod.vod_content = (vod.vod_content ? vod.vod_content + "\n" : "") + extra.join("\n");
    return JSON.stringify({ list: [vod] });
  },

  search: function (key, quick, pg) {
    var page = pg || 1;
    var list = [];
    try {
      list = parseList(get("/search_result?kw=" + encodeURIComponent(key) + "&page=" + page));
    } catch (e) {}
    return JSON.stringify({ list: list });
  },

  // 播放：只取完整版源（详情页 JSON-LD contentUrl 且为 mso CDN），
  // 预览源（freemsall CDN 的 10 分钟精简版）一律不返回，不回退 /embedded?hid=
  play: function (flag, id) {
    var url = String(id);
    var hid = "";
    var m = url.match(/hid=([^&]+)/);
    if (m) hid = m[1];
    if (!hid) {
      var mm = url.match(/([A-Za-z0-9_-]{3,})\/?$/);
      if (mm) hid = mm[1];
    }
    if (!hid) return JSON.stringify({ parse: 0, url: "", msg: "无法解析 hid" });
    var hd = { "User-Agent": UA, "Referer": SITE + "/" };
    try {
      var dhtml = get("/video?hid=" + encodeURIComponent(hid));
      var cm = dhtml.match(/"contentUrl"\s*:\s*"([^"]+)"/);
      if (cm) {
        var full = cm[1].replace(/\\\//g, "/");
        // 仅接受完整源（mso CDN），freemsall 预览源视为无完整版
        if (full.indexOf("freemsall") < 0 && /\.m3u8|\.3gp/.test(full)) {
          return JSON.stringify({
            parse: 0,
            url: full,
            header: hd,
            format: "application/x-mpegURL"
          });
        }
        return JSON.stringify({ parse: 0, url: "", msg: "该片源站仅提供预览版，无完整版" });
      }
    } catch (e) {}
    return JSON.stringify({ parse: 0, url: "", msg: "未找到完整版播放地址" });
  }
};

export default _spider;
