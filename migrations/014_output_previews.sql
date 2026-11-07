-- Watermarked, reduced-size preview of each finished file. Kept in the database (small), removed when the output is purged.
create table output_previews (
  output_id uuid primary key references outputs(id) on delete cascade,
  jpeg bytea not null,
  width_px int not null,
  height_px int not null,
  created_at timestamptz not null default now()
);
