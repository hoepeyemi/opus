DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'walletAddress'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'wallet_address'
  ) THEN
    ALTER TABLE "users" RENAME COLUMN "walletAddress" TO "wallet_address";
  END IF;
END $$;

