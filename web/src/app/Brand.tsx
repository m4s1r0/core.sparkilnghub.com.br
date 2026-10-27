/** Marca do painel: assinatura completa a partir de 640 px; abaixo, o monograma (DESIGN.md). */
export function Brand() {
  return (
    <span className="flex items-center gap-3">
      <picture>
        <source media="(min-width: 640px)" srcSet="/brand/sparkling-hub-principal.svg" />
        <img
          src="/brand/monograma-principal.svg"
          alt="Sparkling Hub"
          className="h-10 w-auto sm:h-12"
        />
      </picture>
      <span className="font-semibold">SparkCore</span>
    </span>
  );
}
