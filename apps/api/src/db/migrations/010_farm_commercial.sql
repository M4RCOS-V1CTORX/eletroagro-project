-- Preserve historical numbers and totals; start annual counters above existing notes.
ALTER TABLE public.sales
  ADD COLUMN sale_year INTEGER,
  ADD COLUMN business_activity TEXT NOT NULL DEFAULT 'unassigned' CHECK (business_activity IN ('unassigned','electrical','farm')),
  ADD COLUMN vehicle TEXT NOT NULL DEFAULT '',
  ADD COLUMN plate TEXT NOT NULL DEFAULT '',
  ADD COLUMN driver TEXT NOT NULL DEFAULT '',
  ADD COLUMN destination TEXT NOT NULL DEFAULT '',
  ADD COLUMN freight_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  ADD COLUMN freight_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (freight_cost >= 0),
  ADD COLUMN payment_term_days INTEGER CHECK (payment_term_days BETWEEN 0 AND 3650);
UPDATE public.sales SET sale_year = EXTRACT(YEAR FROM sale_date)::integer;
ALTER TABLE public.sales ALTER COLUMN sale_year SET NOT NULL;
ALTER TABLE public.sales ADD CONSTRAINT sales_year_date_check CHECK (sale_year = EXTRACT(YEAR FROM sale_date)::integer);
ALTER TABLE public.sales DROP CONSTRAINT sales_company_id_sale_number_key;
ALTER TABLE public.sales ADD CONSTRAINT sales_company_year_number_uq UNIQUE(company_id,sale_year,sale_number);
DO $$ DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%total = (subtotal - discount_amount)%'
  LOOP EXECUTE format('ALTER TABLE public.sales DROP CONSTRAINT %I', constraint_name); END LOOP;
END $$;
ALTER TABLE public.sales ADD CONSTRAINT sales_total_with_freight_check CHECK(total = subtotal - discount_amount + freight_amount);
CREATE TABLE public.sale_year_counters (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sale_year INTEGER NOT NULL,
  last_number BIGINT NOT NULL CHECK(last_number > 0),
  PRIMARY KEY(company_id,sale_year)
);
INSERT INTO public.sale_year_counters SELECT company_id,sale_year,MAX(sale_number) FROM public.sales GROUP BY company_id,sale_year;
-- Keep the previous API operational while local and published versions coexist.
-- Its global counter is ignored for new sales; the annual counter is authoritative.
CREATE FUNCTION public.assign_legacy_sale_year() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sale_year IS NULL THEN
    NEW.sale_year := EXTRACT(YEAR FROM NEW.sale_date)::integer;
    INSERT INTO public.sale_year_counters(company_id,sale_year,last_number)
      VALUES(NEW.company_id,NEW.sale_year,1)
      ON CONFLICT(company_id,sale_year) DO UPDATE SET last_number=public.sale_year_counters.last_number+1
      RETURNING last_number INTO NEW.sale_number;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_legacy_year_before_insert BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.assign_legacy_sale_year();
ALTER TABLE public.customers ADD COLUMN payment_term_days INTEGER CHECK(payment_term_days BETWEEN 0 AND 3650);
ALTER TABLE public.purchases ADD COLUMN business_activity TEXT NOT NULL DEFAULT 'unassigned' CHECK(business_activity IN ('unassigned','electrical','farm'));
ALTER TABLE public.financial_entries ADD COLUMN business_activity TEXT NOT NULL DEFAULT 'unassigned' CHECK(business_activity IN ('unassigned','electrical','farm'));
ALTER TABLE public.financial_entries DROP CONSTRAINT financial_entries_source_type_check;
ALTER TABLE public.financial_entries ADD CONSTRAINT financial_entries_source_type_check CHECK(source_type IN ('manual','sale','purchase','freight'));
CREATE TABLE public.transport_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vehicle TEXT NOT NULL CHECK(length(trim(vehicle)) BETWEEN 2 AND 120),
  plate TEXT NOT NULL DEFAULT '' CHECK(length(plate)<=12),
  driver TEXT NOT NULL DEFAULT '' CHECK(length(driver)<=120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id,vehicle,plate,driver)
);
CREATE INDEX sales_customer_statement_idx ON public.sales(company_id,customer_id,sale_date DESC);
CREATE INDEX financial_entries_activity_idx ON public.financial_entries(company_id,business_activity,competence_date);
