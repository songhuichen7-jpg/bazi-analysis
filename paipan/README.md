# paipan

Python port of the Node.js paipan-engine (BaZi chart computation).

## Usage

```python
from paipan import compute, BirthInput
result = compute(BirthInput(year=1990, month=5, day=15, hour=10, minute=30,
                            city="北京", gender="male"))
```

## Testing

```bash
uv run pytest paipan/tests/
```

Regression tests are oracle-driven: outputs must match the Node.js reference
implementation in `../paipan-engine/` byte-for-byte (floats within 1e-9).

See `tests/regression/generate_oracle.md` for how to regenerate oracle fixtures.
