CREATE TABLE public.load_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  property TEXT NOT NULL CHECK (length(trim(property)) BETWEEN 1 AND 200),
  producer TEXT NOT NULL CHECK (length(trim(producer)) BETWEEN 1 AND 200),
  forecast_date DATE NOT NULL,
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX load_forecasts_company_date_idx ON public.load_forecasts (company_id, forecast_date DESC, created_at DESC);
