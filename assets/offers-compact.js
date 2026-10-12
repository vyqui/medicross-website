// Cards are open in the HTML at every viewport size, including without JS.
// Follow a detail link even if the visitor has manually closed that card.
(function () {
  function openLinkedDetail() {
    var target = document.getElementById(location.hash.slice(1));
    if (target && target.matches('details')) target.open = true;
  }
  document.querySelectorAll('.lp-bonus-brief').forEach(function (link) {
    link.addEventListener('click', function () {
      var target = document.getElementById(link.hash.slice(1));
      if (target && target.matches('details')) target.open = true;
    });
  });
  window.addEventListener('hashchange', openLinkedDetail);
  openLinkedDetail();
})();
