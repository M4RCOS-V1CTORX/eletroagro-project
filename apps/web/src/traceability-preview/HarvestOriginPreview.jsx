import HarvestOriginPage from '../traceability-public/HarvestOriginPage.jsx';

const demonstrationHarvest = {
  product: 'Banana-prata',
  property: 'Fazenda Boa Vista',
  producers: ['Maria Oliveira', 'João Santos'],
  harvestDate: '04/11/2026',
};

export default function HarvestOriginPreview() {
  return <HarvestOriginPage harvest={demonstrationHarvest} isPreview />;
}
