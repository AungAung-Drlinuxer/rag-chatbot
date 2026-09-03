"""Eval harness HTTP routes (admin-only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.dependencies import get_current_user, require_role

router = APIRouter(prefix="/api/eval", tags=["eval"])


@router.post("/run")
async def eval_run_endpoint(user: str = Depends(get_current_user),
                            role: str = Depends(require_role("admin"))) -> dict:
    """Run the eval harness — admin-only."""
    from eval.rag.runner import run_eval

    return await run_eval()


@router.get("")
def eval_cases_endpoint(user: str = Depends(get_current_user)) -> dict:
    """Return the eval dataset (no scoring, just questions + expectations)."""
    from eval.rag.runner import load_cases

    cases = load_cases()
    return {"n_cases": len(cases),
            "cases": [{"question": c.question, "domain": c.expected_domain,
                       "must_contain": c.answer_must_contain,
                       "expected_sources": c.expected_source_page_ids} for c in cases]}
