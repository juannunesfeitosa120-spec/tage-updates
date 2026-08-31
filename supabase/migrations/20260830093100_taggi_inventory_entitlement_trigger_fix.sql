-- Count items inherit authorization from their parent inventory session.
-- The table intentionally has no direct group_id column.
drop trigger if exists taggi_inventory_count_items_entitlement on public.taggi_inventory_count_items;
