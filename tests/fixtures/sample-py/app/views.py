from flask import Blueprint, request, jsonify
from app.billing import create_invoice

bp = Blueprint("billing", __name__)

@bp.post("/invoices")
def post_invoice():
    body = request.get_json(force=True)
    inv = create_invoice(int(body["amount"]), body["region"])
    return jsonify(id=inv.id, tax_cents=inv.tax_cents), 201
