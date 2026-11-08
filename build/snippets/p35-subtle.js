// Swap to a new number: each changed digit gets a slot with the old digit and
// the new one, and --subtle-dir sets whether they rise or fall.
const number = document.querySelector(".t-subtle-number");
let value = 1284;

function setValue(next) {
  const prev = value.toLocaleString("en-US");
  const str = next.toLocaleString("en-US");
  const sameLength = prev.length === str.length;
  number.style.setProperty("--subtle-dir", next >= value ? "1" : "-1");
  number.setAttribute("aria-label", str);
  number.classList.remove("is-animating");
  number.replaceChildren();
  [...str].forEach((ch, i) => {
    if (sameLength && prev[i] === ch) {
      number.append(ch);
      return;
    }
    const slot = document.createElement("span");
    slot.className = "t-subtle-slot";
    if (sameLength) {
      const old = document.createElement("span");
      old.className = "t-subtle-old";
      old.setAttribute("aria-hidden", "true");
      old.textContent = prev[i];
      slot.appendChild(old);
    }
    const fresh = document.createElement("span");
    fresh.className = "t-subtle-new";
    fresh.textContent = ch;
    slot.appendChild(fresh);
    number.appendChild(slot);
  });
  value = next;
  void number.offsetHeight; // force reflow
  number.classList.add("is-animating");
}
