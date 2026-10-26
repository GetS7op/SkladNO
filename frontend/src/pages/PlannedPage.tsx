import { useParams } from 'react-router-dom';

export const PLANNED = [
  {
    slug: 'pools',
    id: 'F-04',
    title: 'Вайтлист пулов',
    text: 'Пулы и стратум-линки (1–3, минимум один) для шаблонов настроек. Удаление запрещено, только архив.',
  },
  {
    slug: 'workers',
    id: 'F-05',
    title: 'Вайтлист воркеров',
    text: 'Воркеры по пулам и группам, онлайн-проверка. «Онлайн» и «XP» группы — сумма по активным воркерам.',
  },
  {
    slug: 'warehouses',
    id: 'F-06',
    title: 'Склады',
    text: 'Сводка размещения и вместимости по Парку и Мастерской на основе карты местоположений.',
  },
  {
    slug: 'containers',
    id: 'F-07',
    title: 'Контейнеры',
    text: 'Шаблоны контейнеров: мощность (кВт, жёсткий предел), стеллажи, полки, устройств на полку.',
  },
  {
    slug: 'modules',
    id: 'F-08',
    title: 'Модули',
    text: 'Модуль — набор экземпляров контейнеров с расположением и порядковыми номерами.',
  },
  {
    slug: 'map',
    id: 'F-09',
    title: 'Карта',
    text: 'Адреса мест по формуле MXCXSXP и размещение сканированием ТСД: штрихкод полки + INDEX.',
  },
] as const;

export function PlannedPage() {
  const { slug } = useParams();
  const item = PLANNED.find((p) => p.slug === slug);
  if (!item) return null;
  return (
    <section className="planned-page">
      <p className="eyebrow">{item.id} · приоритет P2</p>
      <h1>{item.title}</h1>
      <p>{item.text}</p>
      <p className="muted">
        Раздел описан в SPEC.md и войдёт в следующий этап. Первый этап — функции P1: устройства, клиенты и
        поставки.
      </p>
    </section>
  );
}
