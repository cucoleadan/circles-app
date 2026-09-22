-- Track audience sweeps beside historical streams so one import run can expose
-- consistent selection, progress, pause, resume, and failure state.
alter table import_run_streams
  drop constraint if exists import_run_streams_stream_check;

alter table import_run_streams
  add constraint import_run_streams_stream_check check (stream in
    ('activity', 'owned_notes', 'owned_posts', 'outbound_actions',
     'subscribers', 'followers'));
