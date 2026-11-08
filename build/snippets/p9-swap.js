// Swap to a new number: wrap each changed digit in a slot with the old digit,
// force a reflow, then re-add .is-animating. The leading characters the old and
// new number share are marked data-same and stay still. The last two characters
// ride 1× / 2× --digit-stagger behind the others.
const group = document.querySelector(".t-digit-group");
let current = group.textContent.replace(/\s+/g, "");

function setDigits(str) {
  let same = 0;
  while (same < current.length && same < str.length && current[same] === str[same]) same++;
  group.classList.remove("is-animating");
  group.replaceChildren();
  [...str].forEach((ch, i) => {
    const fresh = document.createElement("span");
    fresh.className = "t-digit";
    fresh.textContent = ch;
    if (i < same || !/\d/.test(ch)) {
      fresh.dataset.same = "";
      group.appendChild(fresh);
      return;
    }
    const slot = document.createElement("span");
    slot.className = "t-digit-slot";
    const fromEnd = str.length - 1 - i;
    if (fromEnd === 1) slot.dataset.stagger = "1";
    else if (fromEnd === 0) slot.dataset.stagger = "2";
    const oldCh = current[current.length - (str.length - i)];
    if (oldCh && /\d/.test(oldCh)) {
      const old = document.createElement("span");
      old.className = "t-digit-old";
      old.setAttribute("aria-hidden", "true");
      old.textContent = oldCh;
      slot.appendChild(old);
    }
    slot.appendChild(fresh);
    group.appendChild(slot);
  });
  current = str;
  void group.offsetHeight; // force reflow
  group.classList.add("is-animating");
}
