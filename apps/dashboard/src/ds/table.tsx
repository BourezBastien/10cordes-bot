import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * TABLEAU. Des filets d'un pixel entre les lignes, un filet de 2 px sous
 * l'en-tête, des libellés de colonne en pixel. Le cadre porte le contenant,
 * l'intérieur défile en largeur sur un petit écran.
 */

export interface TableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  className?: string;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<TableColumn<Row>>;
  rows: ReadonlyArray<Row>;
  keyOf: (row: Row) => string;
  /** Nom du tableau, lu par un écran. */
  caption: string;
  empty?: ReactNode;
}

export function DataTable<Row>({ columns, rows, keyOf, caption, empty }: DataTableProps<Row>) {
  return (
    <div className="notched bg-panel">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-line">
              {columns.map((column) => (
                <th key={column.key} scope="col" className="text-label px-4 py-2 text-left font-normal">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-ink-faint">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={keyOf(row)} className="border-b border-line-soft last:border-b-0">
                  {columns.map((column) => (
                    <td key={column.key} className={cn('px-4 py-2.5 align-middle text-ink-soft', column.className)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
