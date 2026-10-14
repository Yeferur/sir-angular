-- Preconditions: both IA tables are InnoDB and interaction_id has zero orphans.
ALTER TABLE ia_tool_runs
  ADD CONSTRAINT fk_ia_tool_runs_interaccion
  FOREIGN KEY (interaction_id) REFERENCES ia_interacciones(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
