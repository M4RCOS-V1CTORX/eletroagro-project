import { CalendarDays, Leaf, MapPin, Users } from 'lucide-react';

export default function HarvestOriginDetails({ harvest }) {
  const fields = [
    { label: 'Produto', value: harvest.product, icon: Leaf },
    { label: 'Propriedade', value: harvest.property, icon: MapPin },
    {
      label: 'Responsáveis pela colheita',
      value: harvest.producers.join(' e '),
      icon: Users,
    },
    { label: 'Data da colheita', value: harvest.harvestDate, icon: CalendarDays },
  ];

  return (
    <dl className="harvest-origin-details">
      {fields.map(({ label, value, icon: Icon }) => (
        <div className="harvest-origin-field" key={label}>
          <dt>
            <span className="harvest-origin-field-icon"><Icon size={20} strokeWidth={1.6} aria-hidden="true" /></span>
            <span>{label}</span>
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
