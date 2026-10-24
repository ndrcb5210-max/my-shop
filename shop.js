/* =====================================================================
   우리 가게 쇼핑몰 템플릿 - shop.js (버전 1.0, 2026-10-24)
   이 파일은 고치지 않아도 됩니다.
   - 상품은 products.txt 에서 바꿉니다.
   - 가게 정보와 사업자 정보는 shop-info.txt 에서 바꿉니다.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- 1. 파일 읽기 (UTF-8 먼저, 안 되면 EUC-KR) ---------- */
  function decodeText(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      try { return new TextDecoder('euc-kr').decode(buf); }
      catch (e2) { return new TextDecoder('utf-8').decode(buf); }
    }
  }

  function loadText(name) {
    var url = name + (name.indexOf('?') < 0 ? '?' : '&') + 'v=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' (' + r.status + ')');
      return r.arrayBuffer();
    }).then(decodeText);
  }

  function normalizeText(s) {
    return String(s || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  }

  function cleanKey(k) {
    return String(k || '')
      .replace(/[\s\u00A0\u3000]/g, '')
      .replace(/[\[\]()（）<>「」『』*·.\-_]/g, '')
      .toLowerCase();
  }

  /* '키: 값' 나누기. 콜론(:), 전각 콜론(：), 등호(=)를 모두 받습니다. */
  function splitKV(line) {
    var m = /^([^:：=]{1,20})[:：=](.*)$/.exec(line);
    if (!m) return null;
    return { rawKey: m[1].trim(), value: m[2].trim() };
  }

  function buildAlias(map) {
    var out = {};
    Object.keys(map).forEach(function (canon) {
      map[canon].forEach(function (a) { out[cleanKey(a)] = canon; });
    });
    return out;
  }

  /* ---------- 2. 상품 목록(products.txt) ---------- */
  var PRODUCT_KEYS = {
    name: ['상품명', '상품이름', '이름', '상품', '품명', '제품명', '제품', 'name', 'title'],
    price: ['가격', '판매가', '판매가격', '값', '금액', 'price'],
    oldPrice: ['원래가격', '원가', '정가', '정상가', '할인전가격', '이전가격', '소비자가', '소비자가격'],
    unit: ['단위', '용량', '중량', '규격', '수량', 'unit'],
    photo: ['사진', '사진파일', '이미지', '그림', 'image', 'photo', 'img', 'picture'],
    desc: ['설명', '상품설명', '소개', '내용', 'description', 'desc'],
    status: ['상태', '판매상태', '재고', 'status'],
    link: ['구매링크', '구매주소', '구매', '링크', '스토어', '스토어링크', '스마트스토어', '주문링크', 'link', 'url']
  };
  var P_ALIAS = buildAlias(PRODUCT_KEYS);

  /* 가격 글자를 숫자로: "15,000원", "15000", "1만5천원", "35,000원(1kg)" 모두 받습니다. */
  function parsePrice(s) {
    if (s == null) return null;
    var t = String(s)
      .replace(/[\uFF10-\uFF19]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }) // 전각 숫자
      .replace(/[\s\u00A0]/g, '').replace(/，/g, ',');
    if (!t) return null;
    if (/\d(만|천|백)/.test(t)) {
      var total = 0, m, last = 0, re = /(\d+(?:\.\d+)?)(만|천|백)/g;
      while ((m = re.exec(t))) {
        total += parseFloat(m[1]) * (m[2] === '만' ? 10000 : m[2] === '천' ? 1000 : 100);
        last = re.lastIndex;
      }
      var rest = /^(\d+)/.exec(t.slice(last));
      if (rest) total += parseInt(rest[1], 10);
      return total > 0 ? Math.round(total) : null;
    }
    var m2 = /\d[\d,.]*/.exec(t);
    if (!m2) return null;
    var tok = m2[0].replace(/[,.]+$/, '');
    if (/^\d{1,3}(\.\d{3})+$/.test(tok)) tok = tok.replace(/\./g, '');
    tok = tok.replace(/,/g, '');
    var n = Math.round(parseFloat(tok));
    return isFinite(n) && n > 0 ? n : null;
  }

  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (/^\/\//.test(u)) return 'https:' + u;
    if (/^[\w-]+(\.[\w-]+)+(\/|\?|$)/.test(u)) return 'https://' + u;
    return '';
  }

  function parseProducts(text) {
    var lines = normalizeText(text).split('\n');
    var blocks = [], cur = [];
    lines.forEach(function (line) {
      var t = line.replace(/[\u00A0\u3000]/g, ' ').trim();
      if (!t) { if (cur.length) { blocks.push(cur); cur = []; } return; }
      if (t.charAt(0) === '#' || t.indexOf('//') === 0) return;
      cur.push(t);
    });
    if (cur.length) blocks.push(cur);

    var items = [], warnings = [];
    blocks.forEach(function (block) {
      var segs = [], seg;
      function newSeg() { seg = { fields: {}, extra: [], has: {} }; segs.push(seg); }
      newSeg();
      block.forEach(function (t) {
        var kv = splitKV(t);
        var canon = kv ? P_ALIAS[cleanKey(kv.rawKey)] : null;
        if (!canon) { seg.extra.push(t); return; }           // 키가 아닌 줄 → 설명에 붙임
        if (canon === 'name' && seg.fields.name) newSeg();   // 빈 줄 없이 다음 상품이 시작된 경우
        else if (canon !== 'name' && canon !== 'desc' && seg.has[canon] && seg.fields.name) newSeg();
        if (canon === 'desc') { if (kv.value) seg.extra.push(kv.value); }
        else seg.fields[canon] = kv.value;
        seg.has[canon] = true;
      });
      segs.forEach(function (s) {
        if (!s.fields.name) {
          var prev = items[items.length - 1];
          if (prev) {                                        // 설명 중간에 빈 줄을 넣은 경우 → 앞 상품에 이어 붙임
            Object.keys(s.fields).forEach(function (k) { if (!prev.raw[k]) prev.raw[k] = s.fields[k]; });
            if (s.extra.length) prev.descLines = prev.descLines.concat([''], s.extra);
          } else if (s.extra.length || Object.keys(s.fields).length) {
            warnings.push('상품명이 없는 부분을 건너뛰었습니다: ' + (s.extra[0] || JSON.stringify(s.fields)));
          }
          return;
        }
        items.push({ raw: s.fields, descLines: s.extra });
      });
    });

    var products = items.map(function (it, i) {
      var r = it.raw;
      var price = parsePrice(r.price);
      var old = parsePrice(r.oldPrice);
      var st = String(r.status || '').replace(/\s/g, '');
      return {
        id: i + 1,
        name: r.name,
        priceText: String(r.price || '').trim(),
        price: price,
        oldPrice: old && price && old > price ? old : null,
        unit: r.unit || '',
        photo: r.photo || '',
        desc: it.descLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
        soldOut: /품절|매진|없음|sold|판매중지|일시중지|재고없/i.test(st),
        hidden: /숨김|숨기|안보|비공개|hide/i.test(st),
        link: safeUrl(r.link)
      };
    });
    return { products: products, warnings: warnings };
  }

  /* ---------- 3. 가게 정보(shop-info.txt) ---------- */
  var INFO_KEYS = {
    shopName: ['가게이름', '가게명', '상점이름', '상점명', '쇼핑몰이름', '몰이름', '가게'],
    tagline: ['한줄소개', '소개', '가게소개', '부제목'],
    phone: ['전화번호', '전화', '연락처', '휴대폰', '핸드폰', '휴대전화'],
    smsOrder: ['문자주문', '문자', '문자받기'],
    kakao: ['카카오톡채널', '카카오톡채널링크', '카카오톡', '카톡', '카카오채널', '카톡채널', '카카오'],
    formLink: ['주문서링크', '주문서', '구글폼', '설문지', '주문서주소'],
    account: ['입금계좌', '계좌', '계좌번호', '입금'],
    escrow: ['구매안전서비스', '에스크로', '구매안전'],
    shipping: ['배송안내', '배송', '택배안내', '배송비'],
    refund: ['교환환불안내', '교환반품안내', '교환환불', '환불안내', '반품안내', '교환안내'],
    hours: ['영업시간', '상담시간', '운영시간', '전화받는시간'],
    courier: ['택배회사', '택배사', '배송업체'],
    privacyDate: ['처리방침시행일', '개인정보처리방침시행일', '시행일'],
    bizName: ['상호', '상호명', '회사명'],
    ceo: ['대표자', '대표자명', '대표', '대표자성명'],
    bizNo: ['사업자등록번호', '사업자번호', '사업자등록'],
    mailOrderNo: ['통신판매업신고번호', '통신판매업신고', '통신판매신고번호', '통신판매업', '통신판매번호'],
    address: ['주소', '사업장주소', '영업소주소', '사업장소재지', '소재지'],
    email: ['이메일', '전자우편', '메일', 'email', 'e-mail'],
    hosting: ['호스팅제공자', '호스팅', '호스팅업체', '호스팅서비스제공자', '호스팅사업자'],
    privacyOfficer: ['개인정보보호책임자', '개인정보책임자', '개인정보관리책임자', '개인정보보호담당자']
  };
  var I_ALIAS = buildAlias(INFO_KEYS);
  /* 여러 줄로 이어 써도 되는 칸 */
  var MULTI_LINE = { tagline: 1, shipping: 1, refund: 1, escrow: 1, hours: 1, account: 1 };

  function parseInfo(text) {
    var info = {}, lastKey = null, unknown = [];
    normalizeText(text).split('\n').forEach(function (line) {
      var t = line.replace(/[\u00A0\u3000]/g, ' ').trim();
      if (!t) { lastKey = null; return; }
      if (t.charAt(0) === '#' || t.indexOf('//') === 0) return;
      var kv = splitKV(t);
      var canon = kv ? I_ALIAS[cleanKey(kv.rawKey)] : null;
      if (canon) { info[canon] = kv.value; lastKey = canon; return; }
      if (lastKey && (!kv || MULTI_LINE[lastKey])) {             // 다음 줄로 이어 쓴 글
        info[lastKey] = (info[lastKey] ? info[lastKey] + '\n' : '') + t;
        return;
      }
      unknown.push(t);
      if (kv) lastKey = null;
    });
    info.smsOrder = isYes(info.smsOrder);
    info.kakao = safeUrl(info.kakao);
    info.formLink = safeUrl(info.formLink);
    if (unknown.length) console.warn('[shop] shop-info.txt 에서 알아보지 못한 줄:', unknown);
    return info;
  }

  function isYes(v) {
    return /^(예|네|yes|y|o|ㅇ|사용|받음|받습니다|가능|true|1)/i.test(String(v || '').trim());
  }

  /* ---------- 4. 작은 도구들 ---------- */
  function won(n) { return Number(n).toLocaleString('ko-KR') + '원'; }
  function digits(s) { return String(s || '').replace(/[^\d]/g, ''); }
  function telHref(phone) { return 'tel:' + String(phone || '').replace(/[^\d+]/g, ''); }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  /* 아이폰은 sms:번호&body=, 그 밖의 폰은 sms:번호?body= */
  function smsHref(phone, body, ios) {
    var num = String(phone || '').replace(/[^\d+]/g, '');
    return 'sms:' + num + (ios ? '&' : '?') + 'body=' + encodeURIComponent(body);
  }
  function isPracticeHost(host, search) {
    return /\.github\.io$/i.test(host || '') || /[?&]practice=1\b/.test(search || '');
  }

  var IMG_EXT = ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.webp', '.gif', '.svg'];
  function imageCandidates(name) {
    name = String(name || '').trim().replace(/\\/g, '/');
    if (!name) return [];
    if (/^https?:\/\//i.test(name)) return [name];
    name = name.replace(/^\.?\//, '');
    name = /^images\//i.test(name) ? name.replace(/^images\//i, 'images/') : 'images/' + name;
    var list = [];
    function add(x) { if (list.indexOf(x) < 0) list.push(x); }
    var m = /^(.*?)(\.[A-Za-z0-9]{2,5})$/.exec(name);
    var base = m ? m[1] : name;
    if (m) add(name);
    IMG_EXT.forEach(function (e) { add(base + e); });
    add(base);
    return list;
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function placeholder() {
    return el('div', { class: 'noimg', role: 'img', 'aria-label': '사진 준비 중' }, [el('span', { text: '사진 준비 중' })]);
  }

  function attachImage(wrap, name, alt) {
    var cands = imageCandidates(name), i = 0;
    if (!cands.length) { wrap.appendChild(placeholder()); return; }
    var img = el('img', { alt: alt, decoding: 'async' });
    img.addEventListener('error', function () {
      i++;
      if (i < cands.length) img.src = cands[i];
      else { if (img.parentNode) img.parentNode.removeChild(img); wrap.appendChild(placeholder()); }
    });
    img.src = cands[0];
    wrap.appendChild(img);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* 무시 */ }
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 5000);
  }

  /* ---------- 5. 화면 그리기 ---------- */
  var INFO = {}, PRODUCTS = [], lastFocus = null;

  function renderHeader(info) {
    var name = info.shopName || '우리 가게';
    var h = document.getElementById('shop-name');
    if (h) h.textContent = name;
    var tg = document.getElementById('shop-tagline');
    if (tg) { tg.textContent = info.tagline || ''; tg.hidden = !info.tagline; }
    var call = document.getElementById('header-call');
    if (call) {
      call.innerHTML = '';
      if (info.phone) {
        call.appendChild(el('a', { class: 'btn btn-call', href: telHref(info.phone) }, ['전화 주문 ' + info.phone]));
        if (info.hours) call.appendChild(el('p', { class: 'hours', text: '전화 받는 시간: ' + info.hours }));
      }
    }
  }

  function renderGuide(info) {
    var box = document.getElementById('shop-guide');
    if (!box) return;
    box.innerHTML = '';
    var cards = [];
    var how = el('ol', { class: 'howto' }, [
      el('li', { text: '마음에 드는 상품의 [주문하기] 단추를 누릅니다.' }),
      el('li', { text: '개수를 고르고 전화·문자·카카오톡 가운데 편한 방법으로 주문합니다.' }),
      el('li', { text: info.account ? '안내받은 금액을 아래 계좌로 보내 주시면 상품을 보내 드립니다.' : '가게에서 연락드려 결제 방법을 안내해 드립니다.' })
    ]);
    cards.push(el('section', { class: 'guide-card' }, [el('h3', { text: '주문하는 방법' }), how]));
    if (info.account) cards.push(accountBox(info));
    if (info.shipping) cards.push(el('section', { class: 'guide-card' }, [el('h3', { text: '배송 안내' }), el('p', { class: 'pre', text: info.shipping })]));
    if (info.refund) cards.push(el('section', { class: 'guide-card' }, [el('h3', { text: '교환·환불 안내' }), el('p', { class: 'pre', text: info.refund })]));
    cards.forEach(function (c) { box.appendChild(c); });
  }

  function accountBox(info) {
    var escrow = info.escrow
      ? el('p', { class: 'escrow', text: '구매안전서비스: ' + info.escrow })
      : el('p', { class: 'escrow', text: '돈을 먼저 보내기 전에 가게에 전화로 주문 내용을 한 번 더 확인하세요.' });
    return el('section', { class: 'guide-card account' }, [
      el('h3', { text: '입금 계좌' }),
      el('p', { class: 'account-no', text: info.account }),
      el('button', {
        type: 'button', class: 'btn btn-line', onclick: function () {
          copyText(info.account).then(function (ok) { toast(ok ? '계좌번호를 복사했습니다.' : '복사가 안 되었습니다. 손으로 적어 주세요.'); });
        }
      }, ['계좌번호 복사']),
      escrow
    ]);
  }

  function priceNode(p, big) {
    if (p.price) {
      return el('p', { class: 'price' + (big ? ' big' : '') }, [
        p.oldPrice ? el('s', { class: 'old', text: won(p.oldPrice) }) : null,
        el('strong', { text: won(p.price) }),
        p.unit ? el('span', { class: 'unit', text: ' / ' + p.unit }) : null
      ]);
    }
    var label = p.priceText && !/\d/.test(p.priceText) ? p.priceText : '가격 문의';
    return el('p', { class: 'price ask' + (big ? ' big' : '') }, [el('strong', { text: label }),
      p.unit ? el('span', { class: 'unit', text: ' / ' + p.unit }) : null]);
  }

  function renderProducts(list) {
    var grid = document.getElementById('products');
    if (!grid) return;
    grid.innerHTML = '';
    var shown = list.filter(function (p) { return !p.hidden; });
    if (!shown.length) {
      grid.appendChild(el('p', { class: 'notice', text: '아직 등록된 상품이 없습니다. products.txt 에 상품을 적어 주세요.' }));
      return;
    }
    shown.forEach(function (p) {
      var pic = el('button', { type: 'button', class: 'pic', 'aria-label': p.name + ' 자세히 보기', onclick: function () { openDetail(p); } });
      attachImage(pic, p.photo, p.name);
      if (p.soldOut) pic.appendChild(el('span', { class: 'badge', text: '품절' }));
      var card = el('article', { class: 'card' + (p.soldOut ? ' soldout' : ''), id: 'p' + p.id }, [
        pic,
        el('div', { class: 'card-body' }, [
          el('h3', { class: 'pname' }, [el('button', { type: 'button', class: 'linklike', onclick: function () { openDetail(p); } }, [p.name])]),
          priceNode(p),
          el('div', { class: 'card-actions' }, [
            el('button', { type: 'button', class: 'btn btn-line', onclick: function () { openDetail(p); } }, ['자세히 보기']),
            p.soldOut
              ? el('button', { type: 'button', class: 'btn btn-disabled', disabled: true }, ['품절'])
              : el('button', { type: 'button', class: 'btn btn-main', onclick: function () { openOrder(p, 1); } }, ['주문하기'])
          ])
        ])
      ]);
      grid.appendChild(card);
    });
  }

  /* ---------- 6. 자세히 보기·주문 창 ---------- */
  function modalOpen(title, bodyNodes) {
    var m = document.getElementById('modal');
    var panel = document.getElementById('modal-body');
    document.getElementById('modal-title').textContent = title;
    panel.innerHTML = '';
    bodyNodes.forEach(function (n) { if (n) panel.appendChild(n); });
    if (m.hidden) lastFocus = document.activeElement;
    m.hidden = false;
    document.body.classList.add('modal-on');
    panel.scrollTop = 0;
    var dlg = m.querySelector('.modal-panel');
    dlg.scrollTop = 0;
    document.getElementById('modal-close').focus();
  }
  function modalClose() {
    var m = document.getElementById('modal');
    if (m.hidden) return;
    m.hidden = true;
    document.body.classList.remove('modal-on');
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function openDetail(p) {
    history.replaceState(null, '', '#p' + p.id);
    var pic = el('div', { class: 'detail-pic' });
    attachImage(pic, p.photo, p.name);
    var desc = p.desc ? el('p', { class: 'pre desc', text: p.desc }) : null;
    var actions = p.soldOut
      ? el('div', { class: 'soldout-box' }, [
          el('p', { text: '지금은 품절입니다. 다시 들어오는 날짜는 전화로 물어봐 주세요.' }),
          INFO.phone ? el('a', { class: 'btn btn-call', href: telHref(INFO.phone) }, ['전화하기 ' + INFO.phone]) : null
        ])
      : el('button', { type: 'button', class: 'btn btn-main wide', onclick: function () { openOrder(p, 1); } }, ['이 상품 주문하기']);
    modalOpen(p.name, [pic, p.soldOut ? el('p', { class: 'badge-inline', text: '품절' }) : null, priceNode(p, true), desc, actions]);
  }

  function orderText(p, qty) {
    var L = [];
    L.push('[' + (INFO.shopName || '가게') + '] 주문합니다');
    L.push('상품: ' + p.name + (p.unit ? ' (' + p.unit + ')' : ''));
    L.push('수량: ' + qty);
    if (p.price) L.push('상품 금액: ' + won(p.price * qty));
    L.push('받는 분 성함: ');
    L.push('받는 주소: ');
    L.push('연락처: ');
    return L.join('\n');
  }

  function openOrder(p, qty) {
    if (p.soldOut) { openDetail(p); return; }
    qty = Math.max(1, Math.min(99, qty || 1));
    history.replaceState(null, '', '#p' + p.id);
    var qtyOut = el('output', { class: 'qty-num', 'aria-live': 'polite', text: String(qty) });
    var totalOut = el('p', { class: 'total' });
    var smsA = null;
    function update() {
      qtyOut.textContent = String(qty);
      totalOut.innerHTML = '';
      if (p.price) {
        totalOut.appendChild(document.createTextNode('상품 금액 '));
        totalOut.appendChild(el('strong', { text: won(p.price * qty) }));
      } else {
        totalOut.appendChild(el('strong', { text: '가격은 전화로 알려 드립니다' }));
      }
      if (smsA) smsA.setAttribute('href', smsHref(INFO.phone, orderText(p, qty), isIOS()));
    }
    var stepper = el('div', { class: 'stepper', role: 'group', 'aria-label': '개수 고르기' }, [
      el('button', { type: 'button', class: 'step', 'aria-label': '하나 빼기', onclick: function () { if (qty > 1) { qty--; update(); } } }, ['−']),
      qtyOut,
      el('button', { type: 'button', class: 'step', 'aria-label': '하나 더하기', onclick: function () { if (qty < 99) { qty++; update(); } } }, ['+'])
    ]);

    var btns = [];
    if (INFO.phone) btns.push(el('a', { class: 'btn btn-call', href: telHref(INFO.phone), 'data-order': 'tel' }, ['전화로 주문 ' + INFO.phone]));
    if (INFO.phone && INFO.smsOrder) {
      smsA = el('a', { class: 'btn btn-sms', 'data-order': 'sms' }, ['문자로 주문']);
      btns.push(smsA);
    }
    if (INFO.kakao) {
      btns.push(el('a', {
        class: 'btn btn-kakao', href: INFO.kakao, target: '_blank', rel: 'noopener', 'data-order': 'kakao',
        onclick: function () {
          var text = orderText(p, qty);
          if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(function () {
              toast('주문 내용을 복사했습니다. 카카오톡 채팅창을 길게 눌러 [붙여넣기] 하세요.');
            }, function () {
              toast(legacyCopy(text) ? '주문 내용을 복사했습니다. 채팅창에 [붙여넣기] 하세요.' : '채팅창에 상품 이름과 개수를 적어 주세요.');
            });
          } else {
            toast(legacyCopy(text) ? '주문 내용을 복사했습니다. 채팅창에 [붙여넣기] 하세요.' : '채팅창에 상품 이름과 개수를 적어 주세요.');
          }
        }
      }, ['카카오톡으로 문의']));
    }
    if (INFO.formLink) btns.push(el('a', { class: 'btn btn-line', href: INFO.formLink, target: '_blank', rel: 'noopener', 'data-order': 'form' }, ['주문서 작성하기']));
    if (p.link) btns.push(el('a', { class: 'btn btn-line', href: p.link, target: '_blank', rel: 'noopener', 'data-order': 'link' }, ['구매 페이지로 가기']));
    if (!btns.length) btns.push(el('p', { class: 'notice', text: '주문 방법이 아직 준비되지 않았습니다. (가게 주인께: shop-info.txt 에 전화번호를 적어 주세요)' }));

    var practice = isPracticeHost(location.hostname, location.search)
      ? el('p', { class: 'practice-note', text: '지금은 연습용 화면이라 실제 주문은 받지 않습니다.' }) : null;

    update();
    modalOpen('주문하기', [
      practice,
      el('div', { class: 'order-item' }, [
        el('p', { class: 'order-name', text: p.name + (p.unit ? ' (' + p.unit + ')' : '') }),
        priceNode(p)
      ]),
      el('p', { class: 'label', text: '몇 개 주문하시겠어요?' }),
      stepper,
      totalOut,
      INFO.shipping ? el('p', { class: 'small pre', text: '배송: ' + INFO.shipping }) : null,
      el('p', { class: 'label', text: '아래 단추 가운데 편한 방법을 고르세요' }),
      el('div', { class: 'order-btns' }, btns),
      INFO.account ? accountBox(INFO) : null,
      el('button', { type: 'button', class: 'btn btn-plain', onclick: function () { openDetail(p); } }, ['상품 설명 다시 보기'])
    ]);
  }

  /* ---------- 7. 맨 아래 사업자 정보 ---------- */
  function renderFooter(info) {
    var f = document.getElementById('site-footer');
    if (!f) return;
    f.innerHTML = '';
    function pair(label, value) {
      if (!value) return null;
      return el('span', { class: 'pair' }, [el('b', { text: label }), ' ' + value]);
    }
    function line(nodes) {
      nodes = nodes.filter(Boolean);
      if (!nodes.length) return null;
      var p = el('p');
      nodes.forEach(function (n, i) { if (i) p.appendChild(document.createTextNode(' · ')); p.appendChild(n); });
      return p;
    }
    var bizCheck = null;
    if (digits(info.bizNo).length === 10) {
      bizCheck = el('a', { href: 'https://www.ftc.go.kr/bizCommPop.do?wrkr_no=' + digits(info.bizNo), target: '_blank', rel: 'noopener', class: 'bizcheck' }, ['사업자정보확인']);
    }
    var lines = [
      line([pair('상호', info.bizName || ''), pair('대표자', info.ceo)]),
      line([pair('주소', info.address)]),
      line([pair('전화', info.phone), pair('이메일', info.email)]),
      line([pair('사업자등록번호', info.bizNo), bizCheck]),
      line([pair('통신판매업 신고번호', info.mailOrderNo)]),
      line([pair('호스팅 제공자', info.hosting)]),
      line([pair('개인정보보호책임자', info.privacyOfficer)])
    ];
    var biz = el('div', { class: 'biz' });
    lines.forEach(function (l) { if (l) biz.appendChild(l); });
    f.appendChild(el('nav', { class: 'foot-links', 'aria-label': '약관과 방침' }, [
      el('a', { href: 'terms.html' }, ['이용약관']),
      el('a', { href: 'privacy.html', class: 'privacy-link' }, ['개인정보처리방침']),
      el('a', { href: 'index.html' }, ['처음 화면'])
    ]));
    f.appendChild(biz);

    var missing = [];
    [['bizName', '상호'], ['ceo', '대표자'], ['bizNo', '사업자등록번호'], ['address', '주소'], ['phone', '전화번호'], ['email', '이메일'], ['hosting', '호스팅제공자']]
      .forEach(function (k) { if (!info[k[0]]) missing.push(k[1]); });
    if (missing.length) {
      f.appendChild(el('div', { class: 'owner-note', role: 'note' }, [
        el('strong', { text: '판매 전 사업자 정보를 채워 주세요' }),
        el('p', { text: '비어 있는 칸: ' + missing.join(', ') + ' (shop-info.txt 아래쪽 "사업자 정보")' }),
        !info.mailOrderNo ? el('p', { text: '통신판매업 신고번호가 있으면 함께 적으세요.' }) : null
      ]));
    }
    f.appendChild(el('p', { class: 'copy', text: '© ' + new Date().getFullYear() + ' ' + (info.bizName || info.shopName || '') }));
  }

  /* 이용약관·개인정보처리방침 화면의 빈칸 채우기 */
  function fillInfoFields(info) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-info]'), function (n) {
      var k = n.getAttribute('data-info');
      var v = info[k];
      if (v) { n.textContent = v; n.classList.remove('blank'); }
      else n.classList.add('blank');
    });
  }

  function showError(msg) {
    var box = document.getElementById('load-error');
    if (!box) return;
    box.hidden = false;
    box.textContent = '';
    box.appendChild(el('strong', { text: msg }));
    if (location.protocol === 'file:') {
      box.appendChild(el('p', { text: '컴퓨터에서 파일을 두 번 눌러 열면 상품이 보이지 않습니다. GitHub나 Cloudflare에 올린 뒤 인터넷 주소로 열어 보세요.' }));
    } else {
      box.appendChild(el('p', { text: '파일 이름이 맞는지(products.txt, shop-info.txt), index.html 과 같은 곳에 있는지 확인해 주세요.' }));
    }
  }

  /* ---------- 8. 글자 크게 ---------- */
  function setupFontToggle() {
    var b = document.getElementById('font-toggle');
    if (!b) return;
    function apply(big) {
      document.documentElement.classList.toggle('big', big);
      b.textContent = big ? '글자 보통으로' : '글자 크게';
      b.setAttribute('aria-pressed', big ? 'true' : 'false');
    }
    var big = false;
    try { big = localStorage.getItem('shop-big') === '1'; } catch (e) { big = false; }
    apply(big);
    b.addEventListener('click', function () {
      big = !big; apply(big);
      try { localStorage.setItem('shop-big', big ? '1' : '0'); } catch (e) { /* 무시 */ }
    });
  }

  /* ---------- 9. 시작 ---------- */
  function start() {
    var page = document.body.getAttribute('data-page') || 'home';
    if (isPracticeHost(location.hostname, location.search)) {
      var rb = document.getElementById('practice-ribbon');
      if (rb) rb.hidden = false;
    }
    setupFontToggle();
    var m = document.getElementById('modal');
    if (m) {
      document.getElementById('modal-close').addEventListener('click', modalClose);
      m.addEventListener('click', function (e) { if (e.target === m) modalClose(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') modalClose(); });
    }

    var infoP = loadText('shop-info.txt').then(parseInfo, function (e) {
      showError('가게 정보(shop-info.txt)를 불러오지 못했습니다.');
      console.warn('[shop]', e);
      return {};
    });

    if (page !== 'home') {
      infoP.then(function (info) { INFO = info; renderHeader(info); fillInfoFields(info); renderFooter(info); });
      return;
    }

    var prodP = loadText('products.txt').then(parseProducts, function (e) {
      showError('상품 목록(products.txt)을 불러오지 못했습니다.');
      console.warn('[shop]', e);
      return { products: [], warnings: [], failed: true };
    });

    Promise.all([infoP, prodP]).then(function (r) {
      INFO = r[0];
      PRODUCTS = r[1].products;
      if (r[1].warnings.length) console.warn('[shop] products.txt 확인:', r[1].warnings);
      renderHeader(INFO);
      renderGuide(INFO);
      if (!r[1].failed) renderProducts(PRODUCTS);
      renderFooter(INFO);
      var hm = /^#p(\d+)$/.exec(location.hash);
      if (hm) {
        var p = PRODUCTS.filter(function (x) { return x.id === Number(hm[1]) && !x.hidden; })[0];
        if (p) openDetail(p);
      }
      document.body.classList.add('ready');
    });
  }

  window.ShopTemplate = {
    version: '1.0',
    parseProducts: parseProducts, parsePrice: parsePrice, parseInfo: parseInfo,
    imageCandidates: imageCandidates, smsHref: smsHref, telHref: telHref,
    isPracticeHost: isPracticeHost, decodeText: decodeText, orderText: orderText,
    get products() { return PRODUCTS; }, get info() { return INFO; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
