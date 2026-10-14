/*
 * 내신나침반 — 화면 전환
 * (없음) 첫 화면 · #manage 입력·관리 · #send 태블릿으로 보내기 · #counsel/번호 상담 화면
 */
(function (root) {
  'use strict';

  const app = document.getElementById('app');
  const VIEWS = { counsel: 'CounselView', manage: 'ManageView', send: 'SendView' };
  let mounted = null;

  function route() {
    const [view, id] = root.location.hash.replace(/^#/, '').split('/');
    const next = VIEWS[view] ? root[VIEWS[view]] : root.LandingView;
    if (mounted && mounted !== next) {
      if (root.Tour) root.Tour.stop();
      mounted.unmount();
      root.scrollTo(0, 0);
    }
    mounted = next;
    document.body.dataset.view = VIEWS[view] ? view : 'landing';
    if (next === root.CounselView) next.mount(app, decodeURIComponent(id || ''));
    else next.mount(app);
  }

  root.addEventListener('hashchange', route);
  route();
})(window);
