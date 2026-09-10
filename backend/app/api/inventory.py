"""IT Inventory API (v1.1.9) — help desk asset library.

Endpoints under /api/inventory:
  GET    /            list/search (all authenticated users)
  POST   /            create (admin, knowledge, agent)
  PUT    /{id}        update (admin, knowledge)
  DELETE /{id}        delete (admin)

The chat pipeline queries this table for inventory questions (tool: inventory).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_

from app.auth.deps import get_current_user
from app.auth.rbac import get_role
from app.observability.audit import audit
from app.persistence.database import SessionLocal
from app.persistence.models import InventoryItem

router = APIRouter(prefix="/api/inventory")

_WRITE_ROLES = ("admin", "administrator", "knowledge")


def _can_write(user: str) -> bool:
    return get_role(user) in _WRITE_ROLES


@router.get("")
def list_items(
    q: str = "",
    category: str = "",
    limit: int = 50,
    user: str = Depends(get_current_user),
) -> dict:
    with SessionLocal() as s:
        query = s.query(InventoryItem)
        if q:
            like = f"%{q}%"
            query = query.filter(or_(
                InventoryItem.name.ilike(like),
                InventoryItem.hostname.like(like),
                InventoryItem.ip_address.like(like),
                InventoryItem.assigned_to.like(like),
                InventoryItem.location.like(like),
            ))
        if category:
            query = query.filter(InventoryItem.category == category)
        rows = query.order_by(InventoryItem.name).limit(max(1, min(limit, 200))).all()
    return {"items": [_to_dict(r) for r in rows]}


def _to_dict(r: InventoryItem) -> dict:
    return {
        "id": r.id, "name": r.name, "category": r.category,
        "hostname": r.hostname, "ip_address": r.ip_address,
        "location": r.location, "assigned_to": r.assigned_to,
        "serial": r.serial, "notes": r.notes, "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.post("")
def create_item(body: dict, user: str = Depends(get_current_user)) -> dict:
    if not _can_write(user):
        raise HTTPException(status_code=403, detail="Inventory editing requires admin or knowledge role")
    name = (body.get("name") or "").strip()
    category = (body.get("category") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    if not body.get("category"):
        raise HTTPException(status_code=400, detail="category required")
    with SessionLocal() as s:
        item = InventoryItem(
            name=name[:255],
            category=body.get("category", "server")[:64],
            hostname=(body.get("hostname") or "").strip()[:255] or None,
            ip_address=(body.get("ip_address") or "").strip()[:64] or None,
            location=(body.get("location") or "").strip()[:255] or None,
            assigned_to=(body.get("assigned_to") or "").strip()[:64] or None,
            serial=(body.get("serial") or "").strip()[:255] or None,
            notes=body.get("notes") or None,
            created_by=user,
        )
        s.add(item)
        s.commit()
        s.refresh(item)
    audit("inventory.create", user, detail=f"{item.name} ({item.category})")
    return _to_dict(item)


@router.put("/{item_id}")
def update_item(item_id: int, body: dict, user: str = Depends(get_current_user)) -> dict:
    if not _can_write(user):
        raise HTTPException(status_code=403, detail="Inventory editing requires admin or knowledge role")
    with SessionLocal() as s:
        item = s.query(InventoryItem).filter(InventoryItem.id == item_id).first()
        if item is None:
            raise HTTPException(status_code=404, detail="Inventory item not found")
        for f in ("name", "category", "hostname", "ip_address", "location",
                  "assigned_to", "serial", "notes"):
            if f in body and body[f] is not None:
                setattr(item, f, str(body[f]).strip()[:255] if f != "notes" else body[f])
        s.commit()
        s.refresh(item)
    audit("inventory.update", user, detail=item.name)
    return _to_dict(item)


@router.delete("/{item_id}")
def delete_item(item_id: int, user: str = Depends(get_current_user)) -> dict:
    if get_role(user) not in ("admin", "administrator"):
        raise HTTPException(status_code=403, detail="Administrator permission required")
    with SessionLocal() as s:
        row = s.query(InventoryItem).filter(InventoryItem.id == item_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Inventory item not found")
        name, cat = row.name, row.category
        s.delete(row)
        s.commit()
    audit("inventory.delete", user, detail=f"{name} ({cat})")
    return {"status": "deleted", "name": name}
