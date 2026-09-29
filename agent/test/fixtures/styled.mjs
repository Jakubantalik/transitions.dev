// Fixture: CSS-in-JS inside a template literal is real CSS and must be scanned.
export const card = `
  .card { transition: all 0.3s; }
  .card:hover { transform: translateY(-2px); }
`;
