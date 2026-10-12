// Native details remain usable without JavaScript; expand on desktop only.
(function () {
  var desktop = window.matchMedia('(min-width: 760px)');
  var details = document.querySelectorAll('.lp-implant-detail');
  function syncLayout() {
    details.forEach(function (item) { item.open = desktop.matches; });
    openLinkedDetail();
  }
  function openLinkedDetail() {
    if (location.hash === '#bonus-details') {
      document.getElementById('bonus-details').open = true;
    }
  }
  document.querySelector('.lp-bonus-brief').addEventListener('click', function () {
    document.getElementById('bonus-details').open = true;
  });
  window.addEventListener('hashchange', openLinkedDetail);
  desktop.addEventListener('change', syncLayout);
  syncLayout();
})();
