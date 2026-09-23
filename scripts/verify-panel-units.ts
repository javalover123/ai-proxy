// One-off verification: replicates react-resizable-panels@4.11.2 parsing math
// to prove the new-request vertical panel bug and the fix.
// Source: node_modules/react-resizable-panels/dist/react-resizable-panels.js
//   bt(e)   — line 22-31: number => [e,"px"]; string => suffix parse, default "%"
//   ie(..)  — line 35-55: unit -> px value (px: raw; %: i/100*groupSize)
//   ve(..)  — line 70-130: converts each prop to a percentage via O(u/n*100)
//   O(e)    — line 56: parseFloat(e.toFixed(3))

const O = (e) => parseFloat(e.toFixed(3));

function bt(e) {
  switch (typeof e) {
    case "number":
      return [e, "px"];
    case "string": {
      const t = parseFloat(e);
      return e.endsWith("%")
        ? [t, "%"]
        : e.endsWith("px")
          ? [t, "px"]
          : e.endsWith("rem")
            ? [t, "rem"]
            : e.endsWith("em")
              ? [t, "em"]
              : e.endsWith("vh")
                ? [t, "vh"]
                : e.endsWith("vw")
                  ? [t, "vw"]
                  : [t, "%"]; // <- no-suffix string defaults to "%"
    }
  }
}

// simplified ie(): only px and % matter here (no rem/em/vh/vw elements)
function ie(groupSize, styleProp) {
  const [i, r] = bt(styleProp);
  switch (r) {
    case "%":
      return (i / 100) * groupSize;
    case "px":
      return i;
  }
  return i; // fallback (not exercised here)
}

// Convert a size prop to its percentage-of-group value (mirrors ve())
function toPct(groupSize, styleProp) {
  if (styleProp === undefined) return undefined;
  return O((ie(groupSize, styleProp) / groupSize) * 100);
}

// One pass of the library's U() normalization: scale defaults to sum 100,
// then clamp each to [min,max] (collapsible may collapse below min to collapsedSize),
// then redistribute leftover. Faithful enough to expose the bug.
function computeLayout(groupHeight, panels) {
  // defaults -> pct
  let sizes = panels.map((p) => toPct(groupHeight, p.defaultSize));
  // fill missing defaults equally
  const defined = sizes.filter((s) => s !== undefined);
  const defSum = defined.reduce((a, b) => a + b, 0);
  sizes = sizes.map((s) => (s === undefined ? (100 - defSum) / (panels.length - defined.length) : s));
  // scale to sum 100
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.1) sizes = sizes.map((s) => (100 / sum) * s);
  // clamp
  let leftover = 0;
  sizes = sizes.map((s, i) => {
    const p = panels[i];
    const min = toPct(groupHeight, p.minSize) ?? 0;
    const max = toPct(groupHeight, p.maxSize) ?? 100;
    const clamped = Math.max(min, Math.min(max, s));
    leftover += s - clamped;
    return clamped;
  });
  // redistribute leftover to non-saturated panels (simple pass)
  if (Math.abs(leftover) > 0.01) {
    for (let i = 0; i < sizes.length; i++) {
      const p = panels[i];
      const min = toPct(groupHeight, p.minSize) ?? 0;
      const max = toPct(groupHeight, p.maxSize) ?? 100;
      const room = leftover > 0 ? max - sizes[i] : sizes[i] - min;
      const delta = Math.sign(leftover) * Math.min(Math.abs(leftover), Math.max(0, room));
      if (delta !== 0 && !Number.isNaN(delta)) {
        sizes[i] += delta;
        leftover -= delta;
      }
    }
  }
  return sizes.map(O);
}

const GROUP = 550; // typical vertical group height in px

const configs = {
  "OLD (numbers, HEAD-ish + uncommitted)": {
    editor: { defaultSize: 60, minSize: 15, maxSize: 80 },
    response: { defaultSize: 40, minSize: 10, maxSize: undefined, collapsible: true, collapsedSize: 0 },
  },
  "NEW (% strings, fixed)": {
    editor: { defaultSize: "60%", minSize: "15%", maxSize: "80%" },
    response: { defaultSize: "40%", minSize: "10%", maxSize: undefined, collapsible: true, collapsedSize: "0%" },
  },
};

for (const [name, cfg] of Object.entries(configs)) {
  const panels = [cfg.editor, cfg.response];
  // show parsed percentages of each constraint
  console.log(`\n=== ${name} (group=${GROUP}px) ===`);
  for (const p of panels) {
    console.log(
      `  defaultSize=${String(p.defaultSize).padEnd(6)} -> ${toPct(GROUP, p.defaultSize)}% | ` +
        `minSize=${String(p.minSize).padEnd(5)} -> ${toPct(GROUP, p.minSize)}% | ` +
        `maxSize=${String(p.maxSize).padEnd(6)} -> ${toPct(GROUP, p.maxSize)}%`,
    );
  }
  const [ed, rs] = computeLayout(GROUP, panels);
  console.log(`  -> editor=${ed}%  response=${rs}%`);
}
