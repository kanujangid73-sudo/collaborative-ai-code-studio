import React, { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import { api } from "../lib/api.js";

export default function WorkspaceSettings({ workspace, user, token, refreshKey, onClose, onChanged, onLeft, onDeleted }) {
  const isOwner = workspace.role === "owner";
  const isShared = workspace.owner_id == null; // the default General workspace
  const base = `/api/workspaces/${workspace.id}`;

  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description);
  const [isPrivate, setIsPrivate] = useState(workspace.is_private);
  const [members, setMembers] = useState([]);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef(null);

  const loadMembers = useCallback(() => {
    api(`${base}/members`, { token }).then(setMembers).catch((err) => setError(err.message));
  }, [base, token]);

  useEffect(loadMembers, [loadMembers, refreshKey]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(action) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    }
  }

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await api(base, { token, method: "PATCH", body: { name: name.trim(), description: description.trim(), is_private: isPrivate } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onChanged();
    });
  };

  const addMember = (e) => {
    e.preventDefault();
    if (!invite.trim()) return;
    run(async () => {
      await api(`${base}/members`, { token, method: "POST", body: { username: invite.trim() } });
      setInvite("");
      loadMembers();
    });
  };

  const removeMember = (member) =>
    run(async () => {
      const self = member.user_id === user.id;
      const prompt = self ? `Leave #${workspace.name}?` : `Remove ${member.username} from #${workspace.name}?`;
      if (!window.confirm(prompt)) return;
      await api(`${base}/members/${member.user_id}`, { token, method: "DELETE" });
      if (self) onLeft();
      else loadMembers();
    });

  const deleteWorkspace = () =>
    run(async () => {
      if (!window.confirm(`Delete #${workspace.name} with all its messages and files? This can't be undone.`)) return;
      await api(base, { token, method: "DELETE" });
      onDeleted();
    });

  const me = members.find((m) => m.user_id === user.id);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="ws-settings-title" tabIndex={-1} ref={dialogRef}>
        <div className="card-header">
          <div>
            <h2 id="ws-settings-title">Workspace settings</h2>
            <p>
              {isShared
                ? "The shared General workspace is open to everyone and can't be changed."
                : isOwner
                  ? "You own this workspace."
                  : "Only the owner can change these settings."}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {error && <div className="alert" role="alert">{error}</div>}

        <form className="settings-form" onSubmit={save}>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={60} required disabled={!isOwner} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Description</span>
            <input
              value={description}
              maxLength={200}
              disabled={!isOwner}
              placeholder="What is this workspace for?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className={`toggle ${!isOwner ? "disabled" : ""}`}>
            <input type="checkbox" checked={isPrivate} disabled={!isOwner} onChange={(e) => setIsPrivate(e.target.checked)} />
            <span className="toggle-track" aria-hidden="true"><span /></span>
            Private: only invited members can see and join
          </label>
          {isOwner && (
            <button type="submit" className="button-primary small">{saved ? "Saved ✓" : "Save changes"}</button>
          )}
        </form>

        {!isShared && (
          <section className="settings-section">
            <h3 className="small-heading">Members · {members.length}</h3>
            <ul className="member-list">
              {members.map((m) => (
                <li key={m.user_id}>
                  <Avatar name={m.username} size={28} />
                  <span className="member-name">
                    {m.username} {m.user_id === user.id && <span className="muted">(you)</span>}
                  </span>
                  <span className={`role-tag ${m.role}`}>{m.role}</span>
                  {m.role === "member" && (isOwner || m.user_id === user.id) && (
                    <button className="button-ghost small" onClick={() => removeMember(m)}>
                      {m.user_id === user.id ? "Leave" : "Remove"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {isOwner && (
              <form className="invite-form" onSubmit={addMember}>
                <input
                  value={invite}
                  maxLength={32}
                  placeholder="Invite by username"
                  onChange={(e) => setInvite(e.target.value)}
                  aria-label="Username to invite"
                />
                <button type="submit" className="button-primary small" disabled={!invite.trim()}>Invite</button>
              </form>
            )}
            {!isOwner && !me && (
              <p className="muted small-text">This is a public workspace. Anyone can join it without an invite.</p>
            )}
          </section>
        )}

        {isOwner && (
          <section className="settings-section danger">
            <h3 className="small-heading">Danger zone</h3>
            <button className="button-danger" onClick={deleteWorkspace}>Delete workspace</button>
          </section>
        )}
      </div>
    </div>
  );
}
