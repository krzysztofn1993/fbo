-- Custom migration: Drizzle cannot declare an expression index with NULLS NOT
-- DISTINCT. Sibling names are unique regardless of case, and root categories
-- (parent_id IS NULL) count as siblings of each other.
CREATE UNIQUE INDEX "categories_parent_id_lower_name_key" ON "categories" USING btree ("parent_id", lower("name")) NULLS NOT DISTINCT;
