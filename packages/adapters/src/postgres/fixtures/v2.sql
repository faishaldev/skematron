-- Integration fixture: schema version 2, the migration target for v1.
-- Changes from v1: enum values added; customers.name widened, code dropped, phone added
-- (mid-table, to prove column position is ignored), default and comment changed;
-- orders identity, NOT NULL, check and index changed; legacy_notes dropped;
-- shipments added; invoice_number_seq increment changed.
CREATE TYPE __SCHEMA__.order_status AS ENUM ('pending', 'paid', 'refunded', 'shipped', 'cancelled');

CREATE TABLE __SCHEMA__.customers (
  id serial PRIMARY KEY,
  email text NOT NULL,
  name varchar(200) NOT NULL DEFAULT '',
  phone text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  referred_by integer,
  CONSTRAINT customers_email_key UNIQUE (email),
  CONSTRAINT customers_referred_by_fkey FOREIGN KEY (referred_by)
    REFERENCES __SCHEMA__.customers (id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
COMMENT ON TABLE __SCHEMA__.customers IS 'Customers who place orders';
COMMENT ON COLUMN __SCHEMA__.customers.email IS 'Login email, it''s unique';
CREATE UNIQUE INDEX customers_lower_email_idx ON __SCHEMA__.customers (lower(email));

CREATE TABLE __SCHEMA__.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES __SCHEMA__.customers (id) ON DELETE CASCADE,
  status __SCHEMA__.order_status NOT NULL DEFAULT 'pending',
  quantity integer NOT NULL,
  unit_price numeric(10, 2) NOT NULL,
  total numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  note text NOT NULL,
  CONSTRAINT orders_quantity_check CHECK (quantity BETWEEN 1 AND 1000)
);
CREATE INDEX orders_customer_idx ON __SCHEMA__.orders (customer_id);
CREATE INDEX orders_status_idx ON __SCHEMA__.orders (status);

CREATE TABLE __SCHEMA__.shipments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES __SCHEMA__.orders (id),
  shipped_at timestamptz
);

CREATE SEQUENCE __SCHEMA__.invoice_number_seq AS bigint START WITH 1000 INCREMENT BY 5;
