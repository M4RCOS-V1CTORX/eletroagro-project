CREATE TABLE public.quote_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  quote_id UUID NOT NULL,
  previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN ('draft', 'sent', 'approved', 'rejected', 'expired', 'cancelled')),
  new_status TEXT NOT NULL CHECK (new_status IN ('draft', 'sent', 'approved', 'rejected', 'expired', 'cancelled')),
  reason TEXT,
  actor_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, quote_id) REFERENCES public.quotes(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX quote_status_history_quote_idx
  ON public.quote_status_history (company_id, quote_id, created_at DESC);
