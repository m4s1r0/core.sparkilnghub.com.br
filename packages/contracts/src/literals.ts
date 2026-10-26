import Type, { type TLiteral, type TUnion } from "typebox";

type Literals<T extends readonly string[]> = { -readonly [K in keyof T]: TLiteral<T[K]> };

/** União de literais com o tipo estático preservado (Type.Union sobre `map` inferiria `never`). */
export function literals<const T extends readonly string[]>(values: T): TUnion<Literals<T>> {
  return Type.Union(values.map((value) => Type.Literal(value))) as unknown as TUnion<Literals<T>>;
}
