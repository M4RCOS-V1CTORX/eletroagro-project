CREATE TABLE public.traceability_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL CHECK (length(trim(product_name)) BETWEEN 2 AND 200),
  property_name TEXT NOT NULL CHECK (length(trim(property_name)) BETWEEN 2 AND 200),
  producer_names JSONB NOT NULL CHECK (
    jsonb_typeof(producer_names) = 'array'
    AND jsonb_array_length(producer_names) BETWEEN 1 AND 100
  ),
  harvest_date DATE NOT NULL,
  public_id TEXT NOT NULL UNIQUE CHECK (public_id ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX traceability_labels_company_created_idx
  ON public.traceability_labels(company_id, created_at DESC, id);
