import React, { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  const dialogRef = useRef(null);
  const closeTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  function openModal() {
    const dialog = dialogRef.current;
    window.clearTimeout(closeTimer.current);
    dialog.classList.remove('is-closing');
    dialog.showModal();
    // Establish the initial scale before transitioning into the open state.
    void dialog.offsetWidth;
    dialog.classList.add('is-open');
  }

  function closeModal() {
    const dialog = dialogRef.current;
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    const closeMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')) || 150;
    dialog.classList.remove('is-open');
    dialog.classList.add('is-closing');
    closeTimer.current = window.setTimeout(() => {
      dialog.close();
      dialog.classList.remove('is-closing');
    }, closeMs);
  }

  return (
    <>
      <main>
        <span className="eyebrow">A SMALL INTERACTION</span>
        <h1>A little pause.</h1>
        <p>Sometimes, all you need is a little space.</p>
        <button className="primary" onClick={openModal}>
          Open modal <span aria-hidden="true">↗</span>
        </button>
      </main>

      <dialog
        ref={dialogRef}
        className="t-modal"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
        onCancel={(event) => { event.preventDefault(); closeModal(); }}
        onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}
      >
        <div className="modal-content">
          <button className="close" aria-label="Close modal" onClick={closeModal} autoFocus>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
          <div className="symbol" aria-hidden="true">✳</div>
          <h2 id="modal-title">Hello, a little closer.</h2>
          <p id="modal-description">A quiet place for a thought, a detail, or something worth a moment.</p>
          <button className="primary modal-action" onClick={closeModal}>Got it</button>
        </div>
      </dialog>
    </>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
