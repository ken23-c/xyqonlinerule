// ============================================================
// hgduj.js — 黄果短剧 (https://hgduj.cc) 适配脚本
// 站点类型：SSR HTML（分类/列表/搜索/详情均为服务端渲染页面）
// 接口：
//   GET /category/cate<tid>/?page=N   分类列表（卡片解析）
//   GET /search/<关键词>/             搜索（卡片解析）
//   GET /video/<id>/                  详情页（内嵌 __ARCHIVE_PLAYER__ 播放对象）
// 播放：m3u8 = cdnLine + rawPath；源站无防盗链（无 Referer 也可 200）
// 导出格式：export default（默影视魔改版要求）
// ============================================================

var SITE = "https://hgduj.cc";
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

// 同步延时（毫秒）
function sleep(ms) {
  var start = Date.now();
  while (Date.now() - start < ms) {}
}

// ============ 分类树（首页菜单解析，模块级缓存）============
var _clsCache = null;

function buildClass() {
  if (_clsCache) return _clsCache;
  var html = get(SITE + "/");
  var cls = [];
  var re = /href="\/category\/(cate\d+)\/"[^>]*>\s*([^<]{1,30})/g;
  var m, seen = {};
  while ((m = re.exec(html)) !== null) {
    var cid = m[1];
    var name = m[2].replace(/&[a-z]+;/g, "").trim();
    if (!name || seen[cid]) continue;
    seen[cid] = 1;
    cls.push({ type_id: cid, type_name: name });
  }
  _clsCache = cls;
  return cls;
}

// ============ HTML 卡片解析（列表页/搜索页共用）============
// 卡片：<li class="section-content__item ..."><a href="/video/<id>/" aria-label="标题-<id>">
//       <img data-src="封面"> <div class="cover-duration">时长</div>
// 过滤：href 非 /video/ 的为广告卡片，跳过
function parseCards(html) {
  var out = [];
  var liRe = /<li class="section-content__item[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  var lm;
  while ((lm = liRe.exec(html)) !== null) {
    var block = lm[1];
    var ah = block.match(/<a[^>]+href="(\/video\/\d+\/)"[^>]*>/);
    if (!ah) continue; // 广告/外链卡片
    var id = ah[1].replace(/\/video\/(\d+)\//, "$1");
    var title = "";
    var al = block.match(/aria-label="([^"]*)"/);
    if (al) {
      // aria-label 格式：标题-<id>
      title = al[1].replace(new RegExp("-" + id + "$"), "").trim();
    }
    if (!title) {
      var ti = block.match(/<img[^>]+alt="([^"]*)"/);
      if (ti) title = ti[1].trim();
    }
    var pic = "";
    var im = block.match(/data-src="([^"]+)"/);
    if (im) pic = im[1];
    var remarks = "";
    var du = block.match(/class="cover-duration"[^>]*>\s*([^<]+)/);
    if (du) remarks = du[1].trim();
    out.push({
      vod_id: id,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: remarks
    });
  }
  return out;
}

// 分页总数：解析分页块中最大页码链接 /category/cateXX/<n>/
function parsePageCount(html, tid) {
  var re = new RegExp("href=\"/category/" + tid + "/(\\d+)/\"", "g");
  var m, max = 0;
  while ((m = re.exec(html)) !== null) {
    var n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max || 0;
}

// 搜索关键词：URL 编码（WebHTV 传入的是原始中文，需 encodeURIComponent）
function _enc(s) {
  try { return encodeURIComponent(s); } catch (e) { return s; }
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
      var html = get(SITE + "/category/cate23/");
      list = parseCards(html);
    } catch (e) {}
    return JSON.stringify({ class: cls, list: list });
  },

  // 首页推荐
  homeVod: function () {
    var list = [];
    try {
      var html = get(SITE + "/category/cate23/");
      list = parseCards(html);
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
      var html = get(SITE + "/category/" + tid + "/?page=" + page);
      list = parseCards(html);
      var pc = parsePageCount(html, tid);
      if (pc > 0) pagecount = pc;
    } catch (e) {}
    return JSON.stringify({ class: cls, list: list, page: page, pagecount: pagecount });
  },

  // 详情：解析 __ARCHIVE_PLAYER__ / PLAYER__ 播放对象
  detail: function (id) {
    var html = get(SITE + "/video/" + id + "/");
    var title = "";
    var tm = html.match(/<title>([^<]+?)\s*-\s*黄果短剧/);
    if (tm) title = tm[1].trim();
    if (!title) {
      var om = html.match(/og:title" content="([^"]+)"/);
      if (om) title = om[1].trim();
    }
    // 封面：og:image 优先，回退播放对象 posterImg
    var pic = "";
    var om = html.match(/og:image" content="([^"]+)"/);
    if (om) pic = om[1].trim();

    // 内容：视频标签（vd-tags）优先，回退站点描述
    var content = "";
    var tags = [];
    var tg = html.match(/class="vd-tags"[^>]*>([\s\S]*?)<\/div>/);
    if (tg) {
      var tm2 = tg[1].match(/<a[^>]*>([^<]+)<\/a>/g);
      if (tm2) {
        for (var ti = 0; ti < tm2.length; ti++) {
          var tn = tm2[ti].match(/>([^<]+)</);
          if (tn) tags.push(tn[1].trim());
        }
      }
      if (!tags.length) {
        var tx = tg[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (tx) content = tx;
      }
    }
    if (tags.length) content = "标签：" + tags.join(" / ");
    if (!content) {
      var dm = html.match(/name="description" content="([^"]+)"/);
      if (dm) content = dm[1].trim();
    }

    var rawPath = "", cdnLine = "";
    var pm = html.match(/__ARCHIVE_PLAYER__\s*=\s*(\{[^;]+\})/);
    if (!pm) pm = html.match(/PLAYER__\s*=\s*(\{[^;]+\})/);
    if (pm) {
      try {
        var obj = JSON.parse(pm[1]);
        rawPath = obj.rawPath || "";
        cdnLine = obj.cdnLine || "";
        if (!pic) pic = obj.posterImg || "";
      } catch (e) {}
    }
    // 兜底：未取到 cdnLine 时用详情页域名
    if (!cdnLine) cdnLine = SITE;

    var vod_play_url = "";
    if (rawPath) {
      var m3u8 = cdnLine + rawPath.replace(/\\\//g, "/");
      vod_play_url = "播放$" + m3u8;
    }

    var vod = {
      vod_id: String(id),
      vod_name: title || String(id),
      vod_pic: pic,
      vod_content: content,
      vod_play_from: "黄果",
      vod_play_url: vod_play_url
    };
    return JSON.stringify({ list: [vod] });
  },

  // 搜索
  search: function (key, quick, pg) {
    var page = pg || 1;
    var list = [];
    try {
      var html = get(SITE + "/search/" + _enc(key) + "/");
      list = parseCards(html);
    } catch (e) {}
    return JSON.stringify({ list: list });
  },

  // 播放：直接使用 detail 已解析的 m3u8（id 为 m3u8 直链）
  play: function (flag, id) {
    var url = id;
    if (url.indexOf("http") !== 0) {
      // 非直链（如详情页 URL）时重新解析
      var html;
      try { html = get(id); } catch (e) {}
      if (html) {
        var pm = html.match(/__ARCHIVE_PLAYER__\s*=\s*(\{[^;]+\})/);
        if (!pm) pm = html.match(/PLAYER__\s*=\s*(\{[^;]+\})/);
        if (pm) {
          try {
            var obj = JSON.parse(pm[1]);
            var rawPath = obj.rawPath || "";
            var cdnLine = obj.cdnLine || SITE;
            if (rawPath) url = cdnLine + rawPath.replace(/\\\//g, "/");
          } catch (e) {}
        }
      }
    }
    return JSON.stringify({
      parse: 0,
      url: url,
      header: { "User-Agent": UA, "Referer": REF },
      format: "application/x-mpegURL"
    });
  }
};

export default _spider;
