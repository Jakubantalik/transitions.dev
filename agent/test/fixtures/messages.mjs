// Fixture: strings and comments that mention CSS but are not CSS.
// Matches like "transition: all 0.3s" or "transition: opacity 300ms ease" in a
// comment must not count either.
export const RULE_LABELS = {
  "transition-all": "transition: all",
};

export function explain() {
  console.log("Replace transition: all with named properties and keep 300ms durations on motion tokens.");
  return "Literal duration in transition: opacity 250ms. Use a motion token instead.";
}
