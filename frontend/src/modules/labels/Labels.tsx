import JsBarcode from 'jsbarcode';
import { Printer } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Segmented } from '../../core/ui/ui';
import { type LabelLayout, LAYOUTS, PAGE_CSS } from './layouts';

/** Штрихкод Code128: его читает любой ТСД/сканер в режиме клавиатуры. */
export function Barcode({ value, height = 48 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        displayValue: false,
        height,
        width: 2,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      });
    }
  }, [value, height]);
  return <svg ref={ref} className="barcode" data-value={value} />;
}

/** Лист наклеек: панель (раскладка, печать) и сами наклейки; при печати остаются только наклейки. */
export function LabelSheet(props: {
  title: string;
  subtitle: string;
  layout: LabelLayout;
  onLayout: (layout: LabelLayout) => void;
  toolbar?: ReactNode;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <style>{PAGE_CSS[props.layout]}</style>
      <header className="page-head no-print">
        <div>
          <h1>{props.title}</h1>
          <p className="muted">{props.subtitle}</p>
        </div>
      </header>
      <div className="registry-toolbar no-print">
        <Segmented value={props.layout} onChange={props.onLayout} options={LAYOUTS} />
        {props.toolbar}
        <button
          type="button"
          className="btn primary"
          disabled={props.count === 0}
          onClick={() => window.print()}
        >
          <Printer size={16} /> Печать ({props.count})
        </button>
      </div>
      <div className={`labels labels-${props.layout}`}>{props.children}</div>
    </div>
  );
}
