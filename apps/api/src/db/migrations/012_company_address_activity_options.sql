ALTER TABLE public.companies ADD COLUMN address TEXT CHECK(address IS NULL OR length(address)<=500);

-- Expand constraints without renaming, reclassifying or deleting historical rows.
DO $$ DECLARE target_table TEXT; constraint_name TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['sales','purchases','financial_entries'] LOOP
    FOR constraint_name IN SELECT conname FROM pg_constraint
      WHERE conrelid=('public.'||target_table)::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%business_activity%'
    LOOP EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',target_table,constraint_name); END LOOP;
  END LOOP;
END $$;
ALTER TABLE public.sales ADD CONSTRAINT sales_activity_check CHECK(business_activity IN ('unassigned','electrical','farm','supplier'));
ALTER TABLE public.purchases ADD CONSTRAINT purchases_activity_check CHECK(business_activity IN ('unassigned','electrical','farm','purchase','sale'));
ALTER TABLE public.financial_entries ADD CONSTRAINT financial_entries_activity_check CHECK(business_activity IN ('unassigned','electrical','farm','supplier','purchase','sale'));
