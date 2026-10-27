// Fórmulas de medidas: «ancho - 2 * espesor», «max(10, alto / 2)», «sqrt(2) * lado».
// Analizador propio (nunca `eval`): números, variables, + − × ÷ ^, paréntesis y funciones.

export interface Variable {
  name: string;
  expr: string;
}

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  // Ángulos en grados, como en el resto de la app.
  sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180), tan: (d) => Math.tan((d * Math.PI) / 180),
};
const CONSTANTS: Record<string, number> = { pi: Math.PI };

export const VARIABLE_NAME = /^[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F][A-Za-z0-9_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F]*$/;

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

// Letras latinas con tilde, sin × (U+00D7) ni ÷ (U+00F7), que son operadores.
const LETTER = "A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F";

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = new RegExp(`\\s*(?:(\\d+(?:\\.\\d+)?|\\.\\d+)|([${LETTER}][${LETTER}0-9]*)|(\\*\\*|[-+*/^(),×÷]))`, "y");
  // Dentro de una llamada a función la coma separa argumentos; fuera, es la coma decimal («1,5»).
  const parens: boolean[] = [];
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`Carácter no válido en la fórmula: «${src.slice(i).trim()[0]}»`);
    i = re.lastIndex;
    if (m[1]) {
      let text = m[1];
      const decimal = /^,(\d+)/.exec(src.slice(i));
      if (decimal && !parens[parens.length - 1] && !text.includes(".")) {
        text += "." + decimal[1];
        i += decimal[0].length;
      }
      out.push({ t: "num", v: parseFloat(text) });
    } else if (m[2]) out.push({ t: "id", v: m[2] });
    else {
      const v = m[3] === "**" ? "^" : m[3] === "×" ? "*" : m[3] === "÷" ? "/" : m[3];
      if (v === "(") parens.push(out[out.length - 1]?.t === "id");
      if (v === ")") parens.pop();
      out.push({ t: "op", v });
    }
  }
  return out;
}

/** Variables que usa una fórmula (sin funciones ni constantes). */
export function references(src: string): string[] {
  try {
    const tokens = tokenize(src);
    return [...new Set(tokens.filter((t, i) => t.t === "id" && !(tokens[i + 1]?.t === "op" && tokens[i + 1].v === "(") && !(t.v in CONSTANTS)).map((t) => t.v as string))];
  } catch {
    return [];
  }
}

/** Evalúa una fórmula con los valores dados. Lanza un error legible si no es válida. */
export function evaluate(src: string, scope: Record<string, number>): number {
  const tokens = tokenize(src);
  if (!tokens.length) throw new Error("La fórmula está vacía.");
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Falta «${v}» en la fórmula.`);
    pos++;
  };
  // expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := '-' unary | power ; power := atom ('^' unary)?
  const expr = (): number => {
    let v = term();
    while (isOp("+") || isOp("-")) v = tokens[pos++].v === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (isOp("*") || isOp("/")) {
      const op = tokens[pos++].v;
      const r = unary();
      if (op === "/" && r === 0) throw new Error("División por cero en la fórmula.");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const unary = (): number => {
    if (isOp("-")) return pos++, -unary();
    if (isOp("+")) return pos++, unary();
    return power();
  };
  const power = (): number => {
    const base = atom();
    if (isOp("^")) return pos++, Math.pow(base, unary());
    return base;
  };
  const atom = (): number => {
    const tok = tokens[pos++];
    if (!tok) throw new Error("La fórmula termina antes de tiempo.");
    if (tok.t === "num") return tok.v;
    if (tok.t === "op") {
      if (tok.v !== "(") throw new Error(`Operador inesperado «${tok.v}».`);
      const v = expr();
      expect(")");
      return v;
    }
    if (isOp("(")) {
      const fn = FUNCTIONS[tok.v.toLowerCase()];
      if (!fn) throw new Error(`Función desconocida: ${tok.v}.`);
      pos++;
      const args = [expr()];
      while (isOp(",")) pos++, args.push(expr());
      expect(")");
      return fn(...args);
    }
    if (tok.v in scope) return scope[tok.v];
    if (tok.v.toLowerCase() in CONSTANTS) return CONSTANTS[tok.v.toLowerCase()];
    throw new Error(`Variable desconocida: ${tok.v}.`);
  };
  const v = expr();
  if (pos < tokens.length) throw new Error(`Sobra «${(tokens[pos] as { v: unknown }).v}» en la fórmula.`);
  if (!Number.isFinite(v)) throw new Error("El resultado de la fórmula no es un número válido.");
  return v;
}

/**
 * Valores de todas las variables, resolviendo las que dependen de otras.
 * Devuelve también los errores por variable (fórmula inválida, ciclo o nombre repetido).
 */
export function resolveVariables(vars: Variable[] = []): { values: Record<string, number>; errors: Record<string, string> } {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const byName = new Map<string, Variable>();
  for (const v of vars) {
    if (!VARIABLE_NAME.test(v.name)) errors[v.name] = "Nombre no válido: usa letras, números y «_», sin empezar por número.";
    else if (byName.has(v.name)) errors[v.name] = "Hay dos variables con este nombre.";
    else if (v.name in FUNCTIONS || v.name.toLowerCase() in CONSTANTS) errors[v.name] = "Ese nombre está reservado.";
    else byName.set(v.name, v);
  }
  const visiting = new Set<string>();
  const solve = (name: string): number => {
    if (name in values) return values[name];
    if (errors[name]) throw new Error(`«${name}» tiene un error.`);
    const v = byName.get(name);
    if (!v) throw new Error(`Variable desconocida: ${name}.`);
    if (visiting.has(name)) throw new Error(`Referencia circular en «${name}».`);
    visiting.add(name);
    try {
      const scope: Record<string, number> = {};
      for (const ref of references(v.expr)) if (byName.has(ref)) scope[ref] = solve(ref);
      return (values[name] = evaluate(v.expr, scope));
    } finally {
      visiting.delete(name);
    }
  };
  for (const name of byName.keys()) {
    try {
      solve(name);
    } catch (e) {
      errors[name] = e instanceof Error ? e.message : String(e);
    }
  }
  return { values, errors };
}

/** Fórmula que es solo un número (no hace falta guardarla como fórmula). */
export const isPlainNumber = (src: string) => /^\s*-?(\d+([.,]\d+)?|[.,]\d+)\s*$/.test(src);
