-- Which colour model a finished file is in. Existing outputs are RGB.
alter table outputs add column colour text not null default 'rgb' check (colour in ('rgb','cmyk'));
