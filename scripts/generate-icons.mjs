#!/usr/bin/env node
/**
 * Generates app/components/icons.tsx from the Phosphor icon set.
 *
 * Why generate instead of importing @phosphor-icons/react at runtime: each
 * React icon in that package carries all six weights (thin → fill → duotone),
 * which measured at roughly 3 kB apiece — about 45 kB for the icons this app
 * uses, for art we only ever render at one weight. Extracting the `regular`
 * paths gives byte-identical output for a fraction of that, with no runtime
 * dependency and no barrel-import cost in dev.
 *
 * Phosphor is MIT licensed; the attribution lives in the generated file.
 *
 * `@phosphor-icons/react` is a devDependency purely so this script can run.
 * Re-run it after adding a name to ICONS below:
 *
 *   node scripts/generate-icons.mjs
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

/** Local component name → Phosphor icon name. */
const ICONS = {
  // Expense categories (see shared/categories.ts)
  Food: "ForkKnife",
  Groceries: "ShoppingCart",
  Entertainment: "FilmSlate",
  Transport: "Car",
  Home: "House",
  Travel: "AirplaneTilt",
  Health: "Heartbeat",
  Other: "Tag",

  // Interface
  Plus: "Plus",
  Close: "X",
  SignOut: "SignOut",
  Settlement: "HandCoins",
  Trash: "Trash",
  CaretDown: "CaretDown",
  Receipt: "Receipt",
  SettledUp: "CheckCircle",
};

const WEIGHT = "regular";

async function extract(phosphorName) {
  const url = pathToFileURL(
    `./node_modules/@phosphor-icons/react/dist/defs/${phosphorName}.es.js`,
  ).href;

  let module;
  try {
    module = await import(url);
  } catch {
    throw new Error(
      `No Phosphor icon named "${phosphorName}". Check the name at https://phosphoricons.com, ` +
        `and make sure @phosphor-icons/react is installed (npm i -D @phosphor-icons/react).`,
    );
  }

  const weights = module.default ?? module;
  const element = weights.get(WEIGHT);
  if (!element) throw new Error(`"${phosphorName}" has no ${WEIGHT} weight.`);

  // Renders to one or more <path d="..."/> elements. Normalise the self-closing
  // form React's static renderer omits, so the output is valid JSX.
  return renderToStaticMarkup(element).replace(/><\/path>/g, " />");
}

const entries = await Promise.all(
  Object.entries(ICONS).map(async ([localName, phosphorName]) => ({
    localName,
    phosphorName,
    body: await extract(phosphorName),
  })),
);

const components = entries
  .map(
    ({ localName, phosphorName, body }) => `
/** Phosphor \`${phosphorName}\`. */
export function ${localName}Icon(props: IconProps) {
  return (
    <Icon {...props}>
      ${body}
    </Icon>
  );
}`,
  )
  .join("\n");

const output = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Regenerate with: node scripts/generate-icons.mjs
// Add or remove icons by editing the ICONS map in that script.
//
// Icon artwork from Phosphor Icons (https://phosphoricons.com), MIT licensed,
// extracted at "${WEIGHT}" weight. Only the paths this app actually uses are
// included, so the icon set costs a few hundred bytes instead of pulling in
// every weight of every icon at runtime.

import type { SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Width and height in px. Defaults to 24. */
  size?: number;
}

/**
 * Shared SVG wrapper. \`currentColor\` means an icon always matches the colour
 * of the text around it, which is what keeps them consistent in both themes.
 */
function Icon({ size = 24, ...props }: IconProps & { children?: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}
${components}
`;

writeFileSync("app/components/icons.tsx", output);
console.log(
  `Wrote app/components/icons.tsx with ${entries.length} icons at "${WEIGHT}" weight.`,
);
