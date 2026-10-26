export type LabelLayout = 'a4' | 'thermal';

export const LAYOUTS: { value: LabelLayout; label: string }[] = [
  { value: 'a4', label: 'A4, 3×7 наклеек' },
  { value: 'thermal', label: 'Термопринтер 58×40 мм' },
];

/** Размер страницы печати зависит от раскладки: A4 или одна наклейка на страницу термопринтера. */
export const PAGE_CSS: Record<LabelLayout, string> = {
  a4: '@page { size: A4; margin: 10mm 7mm; }',
  thermal: '@page { size: 58mm 40mm; margin: 0; }',
};
