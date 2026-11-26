import { rentalRefi } from '../domain/budget';
import { money } from '../components/ui';

/** For a rental we keep: no profit, just what the refi needs to pay everything back. */
export function RentalFig({ value, cost }: { value: number; cost: number }) {
  const r = rentalRefi(value, cost);
  return (
    <div>
      <dt>Refi to get all money out</dt>
      <dd>{money(r.cost)}</dd>
      <div className="small">{r.loanToValue === null ? 'Add the finished value to see the loan-to-value' : <>{r.loanToValue}% of the {money(r.value)} value</>}</div>
    </div>
  );
}
