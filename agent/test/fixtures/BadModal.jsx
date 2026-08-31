import { useState } from "react";

export function Settings() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setIsOpen(true)}>Open</button>
      {isOpen && <Modal onClose={() => setIsOpen(false)}>Hello</Modal>}
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal">{children}</div>
    </div>
  );
}
