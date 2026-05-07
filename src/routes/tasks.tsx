import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  GripVertical,
  Home as HomeIcon,
  ListTodo,
  Plus,
  Trash2,
} from "lucide-react";

import { AskBar } from "../components/AskBar";
import { CommentsThread } from "../components/CommentsThread";
import { Sidebar } from "../components/Sidebar";
import { useIsMobile } from "../hooks/use-mobile";
import { useRequireAuth } from "../hooks/use-require-auth";
import {
  createTask,
  deleteTask,
  listTasks,
  listTeams,
  type ChatExecutedAction,
  type Task,
  updateTask,
} from "../lib/api";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks - Notable" },
      {
        name: "description",
        content: "Track meeting action items in a Notable kanban board with open, blocked, and done lanes.",
      },
    ],
  }),
  component: TasksPage,
});

type TaskStatus = "open" | "blocked" | "done";

const TASK_COLUMNS: {
  key: TaskStatus;
  title: string;
  description: string;
}[] = [
  { key: "open", title: "Open", description: "Fresh action items waiting to move." },
  { key: "blocked", title: "Blocked", description: "Tasks that need a dependency, answer, or unlock." },
  { key: "done", title: "Done", description: "Completed work you want to keep visible." },
];

function TasksPage() {
  const { loading: authLoading } = useRequireAuth();
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [mentionableTeammates, setMentionableTeammates] = useState<
    { id: string; email: string; full_name?: string | null }[]
  >([]);

  const refreshTasks = async () => {
    const response = await listTasks();
    setTasks(response.items);
    setError(null);
  };

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    void listTasks()
      .then((response) => {
        if (!active) return;
        setTasks(response.items);
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load tasks");
      });
    return () => {
      active = false;
    };
  }, [authLoading]);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    void listTeams()
      .then((teams) => {
        if (!active) return;
        const flattened = new Map<string, { id: string; email: string; full_name?: string | null }>();
        for (const team of teams) {
          for (const member of team.members) {
            flattened.set(member.email, {
              id: member.id,
              email: member.email,
              full_name: member.full_name,
            });
          }
        }
        setMentionableTeammates(Array.from(flattened.values()));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authLoading]);

  const handleExecutedActions = (actions: ChatExecutedAction[]) => {
    const touchedTasks = actions.some((action) =>
      ["create_task", "update_task_status", "delete_task"].includes(action.action_type),
    );
    if (touchedTasks) {
      void refreshTasks();
    }
  };

  const groupedTasks = useMemo(() => {
    return TASK_COLUMNS.map((column) => ({
      ...column,
      items: tasks
        .filter((task) => task.status === column.key)
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || left.created_at.localeCompare(right.created_at)),
    }));
  }, [tasks]);

  const handleCreateTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const task = await createTask({ title, status: "open", source: "manual" });
      setTasks((current) => [...current, task]);
      setNewTaskTitle("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create task");
    } finally {
      setCreating(false);
    }
  };

  const moveTaskToStatus = async (taskId: string, status: TaskStatus) => {
    const movingTask = tasks.find((task) => task.id === taskId);
    if (!movingTask || movingTask.status === status) return;
    const columnTasks = tasks.filter((task) => task.status === status);
    const nextPosition = columnTasks.length ? Math.max(...columnTasks.map((task) => task.position ?? 0)) + 1 : 1;

    setSavingTaskId(taskId);
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status, position: nextPosition } : task)),
    );
    try {
      const updated = await updateTask(taskId, { status, position: nextPosition });
      setTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to move task");
      const response = await listTasks().catch(() => null);
      if (response) {
        setTasks(response.items);
      }
    } finally {
      setSavingTaskId(null);
      setDragTaskId(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const previous = tasks;
    setTasks((current) => current.filter((task) => task.id !== taskId));
    try {
      await deleteTask(taskId);
    } catch (nextError) {
      setTasks(previous);
      setError(nextError instanceof Error ? nextError.message : "Unable to delete task");
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />

      <main className="relative h-screen flex-1 overflow-y-auto pt-16 md:pt-0">
        {!isMobile && (
          <header className="sticky top-16 z-30 border-b border-border/60 bg-background/88 px-4 py-3 backdrop-blur md:top-0 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 rounded-full border border-border bg-card/60 px-1 py-1 backdrop-blur">
                <button
                  onClick={() => window.history.back()}
                  className="rounded-full p-1.5 text-foreground/70 transition hover:bg-accent"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <Link to="/" className="rounded-full p-1.5 text-foreground/70 transition hover:bg-accent" aria-label="Home">
                  <HomeIcon className="h-4 w-4" />
                </Link>
              </div>
              <div className="text-sm text-muted-foreground">Internal task board</div>
            </div>
          </header>
        )}

        <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-4 sm:px-6 sm:pt-6 lg:px-8">
          <div className="animate-fade-in-up">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tasks</p>
            <h1 className="mt-2 font-serif-display text-3xl leading-tight text-foreground/95 sm:text-5xl">
              Move meeting action items across a real board
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
              Notable now keeps your action items internally too. Tasks created from summaries land here automatically, and you can drag them between open, blocked, and done as work moves.
            </p>
          </div>

          <section className="mt-8 rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-medium text-foreground/92">Add a task manually</div>
                <div className="mt-1 text-xs text-muted-foreground">Useful for work that did not come from a summary but still belongs on the board.</div>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
                <input
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreateTask();
                    }
                  }}
                  placeholder="Add a task to the board"
                  className="h-11 flex-1 rounded-2xl border border-border bg-background/70 px-4 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/20"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateTask()}
                  disabled={creating || !newTaskTitle.trim()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {creating ? "Adding..." : "Add task"}
                </button>
              </div>
            </div>
          </section>

          {error ? (
            <div className="mt-6 rounded-[1.5rem] border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <section className="mt-8 grid gap-4 xl:grid-cols-3">
            {groupedTasks.map((column) => (
              <div
                key={column.key}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const taskId = event.dataTransfer.getData("text/task-id") || dragTaskId;
                  if (!taskId) return;
                  void moveTaskToStatus(taskId, column.key);
                }}
                className={`rounded-[1.75rem] border bg-card/50 p-4 shadow-[var(--shadow-soft)] transition ${
                  dragTaskId ? "border-foreground/20" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground/92">
                      {column.key === "open" ? <ListTodo className="h-4.5 w-4.5" /> : column.key === "blocked" ? <AlertCircle className="h-4.5 w-4.5" /> : <CheckCircle2 className="h-4.5 w-4.5" />}
                      {column.title}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{column.description}</div>
                  </div>
                  <div className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-foreground/80">
                    {column.items.length}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {column.items.length ? (
                    column.items.map((task) => (
                      <article
                        key={task.id}
                        draggable
                        onDragStart={(event) => {
                          setDragTaskId(task.id);
                          event.dataTransfer.setData("text/task-id", task.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDragTaskId(null)}
                        className={`rounded-[1.35rem] border border-border/70 bg-background/50 p-4 transition ${
                          dragTaskId === task.id ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 text-muted-foreground">
                            <GripVertical className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium leading-6 text-foreground/92">{task.title}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              {task.meeting_id ? (
                                <Link
                                  to="/notes/$noteId"
                                  params={{ noteId: task.meeting_id }}
                                  className="rounded-full border border-border bg-card/60 px-3 py-1 transition hover:bg-accent"
                                >
                                  {task.meeting_title || "Open meeting"}
                                </Link>
                              ) : (
                                <span className="rounded-full border border-border bg-card/60 px-3 py-1">Manual task</span>
                              )}
                              <span className="rounded-full border border-border bg-card/60 px-3 py-1">
                                {task.source === "meeting_action_item" ? "From summary" : "Manual"}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDeleteTask(task.id)}
                            className="rounded-full border border-border bg-card/60 p-2 text-foreground/70 transition hover:bg-accent"
                            aria-label={`Delete ${task.title}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {TASK_COLUMNS.filter((nextColumn) => nextColumn.key !== task.status).map((nextColumn) => (
                            <button
                              key={nextColumn.key}
                              type="button"
                              onClick={() => void moveTaskToStatus(task.id, nextColumn.key)}
                              disabled={savingTaskId === task.id}
                              className="rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/82 transition hover:bg-accent disabled:opacity-50"
                            >
                              Move to {nextColumn.title}
                            </button>
                          ))}
                        </div>

                        <div className="mt-4">
                          <CommentsThread
                            entityType="task"
                            entityId={task.id}
                            entityLabel={task.title}
                            title="Task comments"
                            mentionablePeople={mentionableTeammates}
                          />
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-[1.35rem] border border-dashed border-border bg-background/35 px-4 py-6 text-sm text-muted-foreground">
                      Drop tasks here or let a meeting summary create them automatically.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>

      <AskBar
        containerClassName="md:left-64"
        assistantContext={{ page_type: "tasks" }}
        onExecutedActions={handleExecutedActions}
      />
    </div>
  );
}
