CREATE TYPE "public"."account_type" AS ENUM('bank', 'cash', 'investment', 'liability', 'other');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense', 'transfer', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."category_type" AS ENUM('standard', 'labeled');--> statement-breakpoint
CREATE TYPE "public"."reporting_scope" AS ENUM('personal', 'business', 'excluded');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" text NOT NULL,
	"reporting_scope" "reporting_scope" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"type" "category_type" DEFAULT 'standard' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_parent_id_position_key" UNIQUE NULLS NOT DISTINCT("parent_id","position"),
	CONSTRAINT "categories_position_check" CHECK ("categories"."position" >= 0),
	CONSTRAINT "categories_labeled_root_check" CHECK ("categories"."type" = 'standard' OR "categories"."parent_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "legacy_account_map" (
	"legacy_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_account_map_account_id_key" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_category_map" (
	"legacy_id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_account_map" ADD CONSTRAINT "legacy_account_map_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_category_map" ADD CONSTRAINT "legacy_category_map_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");