CREATE TABLE public.traceability_harvests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL CHECK (length(trim(product_name)) BETWEEN 2 AND 200),
  property_id UUID NOT NULL,
  property_name TEXT NOT NULL CHECK (length(trim(property_name)) BETWEEN 2 AND 200),
  harvest_date DATE NOT NULL,
  public_id TEXT NOT NULL UNIQUE CHECK (public_id ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, property_id) REFERENCES public.traceability_properties(company_id, id) ON DELETE CASCADE
);
CREATE INDEX traceability_harvests_company_date_idx ON public.traceability_harvests(company_id, harvest_date DESC, created_at DESC, id);

CREATE TABLE public.traceability_harvest_producers (
  company_id UUID NOT NULL,
  harvest_id UUID NOT NULL,
  producer_id UUID NOT NULL,
  producer_name TEXT NOT NULL CHECK (length(trim(producer_name)) BETWEEN 2 AND 200),
  PRIMARY KEY (company_id, harvest_id, producer_id),
  FOREIGN KEY (company_id, harvest_id) REFERENCES public.traceability_harvests(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, producer_id) REFERENCES public.traceability_producers(company_id, id) ON DELETE CASCADE
);
