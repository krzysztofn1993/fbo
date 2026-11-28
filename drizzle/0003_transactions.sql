CREATE TYPE "public"."legacy_classification_status" AS ENUM('suggested', 'approved', 'rejected', 'conflict', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."legacy_classifier_type" AS ENUM('merchant_rule', 'regex_rule', 'historical_seed', 'similar_history', 'local_classifier', 'ollama');--> statement-breakpoint
CREATE TYPE "public"."legacy_source_kind" AS ENUM('legacy_excel', 'bank_file', 'bank_api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."reporting_class" AS ENUM('standard', 'business_tax', 'business_expense', 'savings_investment');--> statement-breakpoint
CREATE TABLE "legacy_classification_results" (
	"legacy_id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"category_id" uuid,
	"label" text,
	"legacy_rule_id" uuid,
	"legacy_rule_ids" jsonb NOT NULL,
	"classifier_type" "legacy_classifier_type" NOT NULL,
	"classifier_version" text NOT NULL,
	"confidence_bps" integer,
	"reason" text,
	"legacy_historical_proposal_id" uuid,
	"provenance" jsonb NOT NULL,
	"status" "legacy_classification_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_transaction_map" (
	"legacy_id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_transaction_map_transaction_id_key" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_transaction_sources" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"source_kind" "legacy_source_kind" NOT NULL,
	"legacy_merchant_id" uuid,
	"legacy_import_run_id" uuid,
	"importer_type" text,
	"importer_version" text,
	"legacy_source_file_id" uuid,
	"source_file_name" text,
	"source_file_sha256" text,
	"source_file_mime_type" text,
	"source_file_size_bytes" bigint,
	"source_sheet" text,
	"source_cell" text,
	"source_record_index" integer,
	"raw_source_value" text,
	"raw_record_hash" text,
	"normalized_record_hash" text,
	"bank_record_id_hash" text,
	"legacy_bank_connection_id" uuid,
	"bank_provider" text,
	"bank_name" text,
	"bank_country" text,
	"legacy_bank_sync_run_id" uuid,
	"bank_sync_started_at" timestamp with time zone,
	"provider_source_metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "possible_duplicates" (
	"first_transaction_id" uuid NOT NULL,
	"second_transaction_id" uuid NOT NULL,
	"day_difference" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "possible_duplicates_first_transaction_id_second_transaction_id_pk" PRIMARY KEY("first_transaction_id","second_transaction_id"),
	CONSTRAINT "possible_duplicates_distinct_check" CHECK ("possible_duplicates"."first_transaction_id" <> "possible_duplicates"."second_transaction_id"),
	CONSTRAINT "possible_duplicates_day_difference_check" CHECK ("possible_duplicates"."day_difference" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_parts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"label" text,
	"reporting_class" "reporting_class" DEFAULT 'standard' NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"operation_date" date,
	"amount_minor" bigint NOT NULL,
	"description" text,
	"reporting_scope_override" "reporting_scope",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_classification_results" ADD CONSTRAINT "legacy_classification_results_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_classification_results" ADD CONSTRAINT "legacy_classification_results_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_transaction_map" ADD CONSTRAINT "legacy_transaction_map_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_transaction_sources" ADD CONSTRAINT "legacy_transaction_sources_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possible_duplicates" ADD CONSTRAINT "possible_duplicates_first_transaction_id_transactions_id_fk" FOREIGN KEY ("first_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possible_duplicates" ADD CONSTRAINT "possible_duplicates_second_transaction_id_transactions_id_fk" FOREIGN KEY ("second_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_parts" ADD CONSTRAINT "transaction_parts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_parts" ADD CONSTRAINT "transaction_parts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "possible_duplicates_second_transaction_id_idx" ON "possible_duplicates" USING btree ("second_transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_parts_transaction_id_idx" ON "transaction_parts" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_parts_category_id_idx" ON "transaction_parts" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_booking_date_id_idx" ON "transactions" USING btree ("booking_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_account_id_idx" ON "transactions" USING btree ("account_id");