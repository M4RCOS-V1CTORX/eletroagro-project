import { useEffect, useState } from 'react';
import { apiUrl } from '../apiUrl.js';
import HarvestOriginPage from './HarvestOriginPage.jsx';

const dateFormatter = new Intl.DateTimeFormat('pt-BR');

function formatHarvest(data) {
  if (!data || typeof data.product !== 'string' || typeof data.property !== 'string'
    || !Array.isArray(data.producers) || !data.producers.every(name => typeof name === 'string')
    || typeof data.harvestDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.harvestDate)) {
    throw new Error('A consulta retornou dados incompletos. Tente novamente.');
  }
  const date = new Date(`${data.harvestDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error('Não foi possível ler a data da colheita.');
  return { ...data, harvestDate: dateFormatter.format(date) };
}

export default function PublicHarvestPage({ publicId }) {
  const [harvest, setHarvest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    setHarvest(null);
    setLoading(true);
    setError('');
    setNotFound(false);

    async function load() {
      try {
        if (!/^[a-f0-9]{64}$/.test(publicId)) {
          if (active) { setNotFound(true); setError('O endereço de origem é inválido ou está incompleto.'); }
          return;
        }
        const response = await fetch(`${apiUrl}/api/public/traceability/${publicId}`, {
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
        });
        if (response.status === 404) {
          if (active) { setNotFound(true); setError('Este registro de origem não foi encontrado. Confira o QR Code utilizado.'); }
          return;
        }
        if (!response.ok) throw new Error('A consulta está indisponível no momento. Tente novamente em instantes.');
        const body = await response.json();
        const result = formatHarvest(body.harvest);
        if (active) setHarvest(result);
      } catch (error) {
        if (active) setError(error.name === 'TypeError' || error.name === 'AbortError'
          ? 'Não foi possível conectar. Confira sua internet e tente novamente.' : error.message);
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }

    load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [publicId, retry]);

  return <HarvestOriginPage harvest={harvest} loading={loading} error={error} notFound={notFound} onRetry={() => setRetry(value => value + 1)} />;
}
