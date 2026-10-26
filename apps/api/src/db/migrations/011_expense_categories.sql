-- Optional for existing Finance clients; the Expenses form requires a category.
-- Existing records remain explicitly unclassified until reviewed by the user.
ALTER TABLE public.financial_entries
  ADD COLUMN expense_category TEXT
  CHECK (expense_category IS NULL OR
    (length(expense_category) BETWEEN 2 AND 80 AND expense_category = trim(expense_category)));
CREATE INDEX financial_entries_expense_category_idx
  ON public.financial_entries(company_id, expense_category)
  WHERE entry_type = 'expense';
