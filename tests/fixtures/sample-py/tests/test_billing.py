import pytest
from app.billing import calculate_tax

def test_calculate_tax_ca():
    assert calculate_tax(10000, "CA") == 875
