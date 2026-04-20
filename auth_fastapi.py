import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from urllib.parse import urlparse, urlencode
from typing import Any, Dict, List, Optional, Tuple

import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field


class GitHubJsonStorage:
    def __init__(self) -> None:
        self.token = os.getenv("GITHUB_TOKEN", "")
        self.owner = os.getenv("GITHUB_OWNER", "JeffiBR")
        self.repo = os.getenv("GITHUB_REPO", "Dados")
        self.branch = os.getenv("GITHUB_BRANCH", "main")
        self.base_url = "https://api.github.com"

    def is_configured(self) -> bool:
        return bool(self.token and self.owner and self.repo)

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"token {self.token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "Preco-Certo-FastAPI-Auth",
        }

    def read_json(self, path: str) -> Tuple[Optional[Any], Optional[str]]:
        if not self.is_configured():
            return None, None

        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/contents/{path}?ref={self.branch}"
        response = requests.get(url, headers=self._headers(), timeout=30)
        if response.status_code == 404:
            return None, None
        if not response.ok:
            raise RuntimeError(f"Erro ao ler {path}: {response.status_code} - {response.text}")

        payload = response.json()
        content_b64 = (payload.get("content") or "").replace("\n", "")
        if not content_b64:
            return None, payload.get("sha")

        decoded = base64.b64decode(content_b64.encode("utf-8")).decode("utf-8")
        return json.loads(decoded), payload.get("sha")

    def write_json(self, path: str, content: Any, message: str, sha: Optional[str] = None) -> None:
        if not self.is_configured():
            raise RuntimeError("GitHub Storage não configurado")

        url = f"{self.base_url}/repos/{self.owner}/{self.repo}/contents/{path}"
        payload_text = json.dumps(content, ensure_ascii=False, indent=2)
        payload_b64 = base64.b64encode(payload_text.encode("utf-8")).decode("utf-8")

        body: Dict[str, Any] = {
            "message": message,
            "content": payload_b64,
            "branch": self.branch,
        }
        if sha:
            body["sha"] = sha

        response = requests.put(url, headers=self._headers(), json=body, timeout=30)
        if not response.ok:
            raise RuntimeError(f"Erro ao escrever {path}: {response.status_code} - {response.text}")


storage = GitHubJsonStorage()

USERS_DIR = "auth/users"
EMAIL_INDEX_PATH = "auth/index_by_email.json"
PHONE_INDEX_PATH = "auth/index_by_phone.json"
GROUP_PAGES_PATH = "auth/group_pages.json"

DEFAULT_GROUP_PAGES = {
    "usuario": ["marketplace.html", "index.html", "precificacao.html", "produtos-atelie.html", "configuracoes.html", "recarga-celular.html", "historico-compras.html"],
    "administrador": [
        "marketplace.html",
        "index.html",
        "dashboard.html",
        "renovacoes.html",
        "historico-renovacoes.html",
        "servidores.html",
        "revendedores.html",
        "mensagens.html",
        "dindin.html",
        "recebiveis.html",
        "precificacao.html",
        "produtos-atelie.html",
        "configuracoes.html",
        "recarga-celular.html",
        "historico-compras.html",
    ],
    "desenvolvedor": ["*"],
}

AUTH_SECRET = os.getenv("AUTH_SECRET", "preco-certo-fastapi-dev-secret")
TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", "2592000"))
PASSWORD_RESET_TTL_SECONDS = int(os.getenv("AUTH_PASSWORD_RESET_TTL_SECONDS", "900"))
PASSWORD_RESET_CODE_LENGTH = max(4, min(8, int(os.getenv("AUTH_PASSWORD_RESET_CODE_LENGTH", "6"))))
PASSWORD_RESET_EXPOSE_CODE = str(os.getenv("AUTH_PASSWORD_RESET_EXPOSE_CODE", "false")).strip().lower() in {"1", "true", "yes", "on"}
BREVO_API_KEY = str(os.getenv("BREVO_API_KEY", "")).strip()
BREVO_SENDER_EMAIL = str(os.getenv("BREVO_SENDER_EMAIL", "")).strip()
BREVO_SENDER_NAME = str(os.getenv("BREVO_SENDER_NAME", "Preço Certo")).strip()
BREVO_API_BASE = str(os.getenv("BREVO_API_BASE", "https://api.brevo.com")).strip().rstrip("/")
AUTH_PASSWORD_RESET_PAGE_URL = str(os.getenv("AUTH_PASSWORD_RESET_PAGE_URL", "https://jeffibr.github.io/Service/reset-password.html")).strip()


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def normalize_email(value: str) -> str:
    return value.strip().lower()


def normalize_phone(value: str) -> str:
    return re.sub(r"\D+", "", value or "")


def normalize_role(value: str) -> str:
    raw = (value or "").strip().lower()
    if raw in {"desenvolvedor", "developer"}:
        return "desenvolvedor"
    if raw in {"administrador", "admin"}:
        return "administrador"
    return "usuario"


def normalize_sex(value: str) -> str:
    raw = (value or "").strip().lower()
    if raw not in {"masculino", "feminino"}:
        raise HTTPException(status_code=400, detail="Sexo deve ser masculino ou feminino")
    return raw


def hash_password(password: str, salt: Optional[str] = None) -> Dict[str, Any]:
    salt_bytes = bytes.fromhex(salt) if salt else secrets.token_bytes(16)
    iterations = 210_000
    pwd_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, iterations)
    return {
        "salt": salt_bytes.hex(),
        "iterations": iterations,
        "hash": pwd_hash.hex(),
    }


def verify_password(password: str, password_data: Dict[str, Any]) -> bool:
    try:
        salt = str(password_data.get("salt", ""))
        expected = str(password_data.get("hash", ""))
        iterations = int(password_data.get("iterations", 210_000))
        if not salt or not expected:
            return False

        pwd_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations).hex()
        return hmac.compare_digest(pwd_hash, expected)
    except Exception:
        return False


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def b64url_decode(text: str) -> bytes:
    pad = len(text) % 4
    if pad:
        text += "=" * (4 - pad)
    return base64.urlsafe_b64decode(text.encode("utf-8"))


def create_token(payload: Dict[str, Any]) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h = b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    p = b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(AUTH_SECRET.encode("utf-8"), f"{h}.{p}".encode("utf-8"), hashlib.sha256).digest()
    s = b64url_encode(signature)
    return f"{h}.{p}.{s}"


def decode_token(token: str) -> Dict[str, Any]:
    try:
        h, p, s = token.split(".")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Token inválido") from exc

    expected = hmac.new(AUTH_SECRET.encode("utf-8"), f"{h}.{p}".encode("utf-8"), hashlib.sha256).digest()
    got = b64url_decode(s)
    if not hmac.compare_digest(expected, got):
        raise HTTPException(status_code=401, detail="Token inválido")

    payload = json.loads(b64url_decode(p).decode("utf-8"))
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="Token expirado")
    return payload


def ensure_json_file(path: str, default: Any) -> Tuple[Any, Optional[str]]:
    data, sha = storage.read_json(path)
    if data is not None:
        return data, sha
    storage.write_json(path, default, f"Inicializar {path}")
    data2, sha2 = storage.read_json(path)
    return data2 if data2 is not None else default, sha2


def load_group_pages() -> Dict[str, List[str]]:
    data, _ = ensure_json_file(GROUP_PAGES_PATH, DEFAULT_GROUP_PAGES)
    merged = dict(DEFAULT_GROUP_PAGES)
    if isinstance(data, dict):
        for role in ("usuario", "administrador", "desenvolvedor"):
            pages = data.get(role)
            if isinstance(pages, list):
                merged[role] = [str(p) for p in pages if isinstance(p, str)]
    return merged


def load_indexes() -> Tuple[Dict[str, str], Dict[str, str], Optional[str], Optional[str]]:
    email_idx, email_sha = ensure_json_file(EMAIL_INDEX_PATH, {})
    phone_idx, phone_sha = ensure_json_file(PHONE_INDEX_PATH, {})
    return (email_idx if isinstance(email_idx, dict) else {}, phone_idx if isinstance(phone_idx, dict) else {}, email_sha, phone_sha)


def get_user_path(user_id: str) -> str:
    return f"{USERS_DIR}/{user_id}.json"


def read_user(user_id: str) -> Optional[Dict[str, Any]]:
    user, _ = storage.read_json(get_user_path(user_id))
    return user if isinstance(user, dict) else None


def write_user(user: Dict[str, Any], message: str = "Atualizar usuario") -> None:
    path = get_user_path(user["id"])
    _, sha = storage.read_json(path)
    storage.write_json(path, user, message, sha=sha)


def sanitize_user_output(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "phone": user.get("phone"),
        "image_url": user.get("image_url"),
        "address": user.get("address"),
        "cep": user.get("cep"),
        "street": user.get("street"),
        "number": user.get("number"),
        "city": user.get("city"),
        "state": user.get("state"),
        "sex": user.get("sex"),
        "role": user.get("role"),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
        "active": user.get("active", True),
    }


def get_allowed_pages_for_user(user: Dict[str, Any]) -> List[str]:
    role = normalize_role(str(user.get("role") or "usuario"))
    group_pages = load_group_pages()
    pages = list(group_pages.get(role, DEFAULT_GROUP_PAGES["usuario"]))
    if role != "desenvolvedor":
        if "marketplace.html" in pages:
            pages = ["marketplace.html"] + [p for p in pages if p != "marketplace.html"]
        else:
            pages = ["marketplace.html"] + pages
        if "perfil-usuario.html" not in pages:
            pages.append("perfil-usuario.html")
    return pages


class RegisterInput(BaseModel):
    nome: str = Field(min_length=2)
    email: EmailStr
    senha: str = Field(min_length=6)
    telefone: str = Field(min_length=8)
    endereco: str = Field(min_length=3)
    cep: Optional[str] = None
    rua: Optional[str] = None
    numero: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    sexo: str


class LoginInput(BaseModel):
    identifier: str = Field(min_length=3)
    password: str = Field(min_length=1)


class ForgotPasswordInput(BaseModel):
    email: Optional[EmailStr] = None
    identifier: Optional[str] = None


class ResetPasswordInput(BaseModel):
    identifier: str = Field(min_length=3)
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=6, max_length=128)


class GroupPagesInput(BaseModel):
    pages: List[str]

class UserUpdateInput(BaseModel):
    nome: Optional[str] = None
    email: Optional[EmailStr] = None
    telefone: Optional[str] = None
    endereco: Optional[str] = None
    cep: Optional[str] = None
    rua: Optional[str] = None
    numero: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    sexo: Optional[str] = None
    image_url: Optional[str] = None
    senha_atual: Optional[str] = None
    senha_nova: Optional[str] = None
    active: Optional[bool] = None


app = FastAPI(title="Preco Certo FastAPI Auth", version="1.0.0")

def normalize_origin(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if raw == "*":
        return "*"
    parsed = urlparse(raw)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return raw.rstrip("/")


allowed_origins_raw = os.getenv("AUTH_CORS_ALLOWED_ORIGINS", "") or os.getenv("CORS_ALLOWED_ORIGINS", "")
allowed_origins: List[str] = []
for item in allowed_origins_raw.split(","):
    normalized = normalize_origin(item)
    if normalized and normalized not in allowed_origins:
        allowed_origins.append(normalized)
if not allowed_origins:
    allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    if not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip()


def get_current_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    token = get_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Autenticacao obrigatoria")

    payload = decode_token(token)
    user_id = str(payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Token inválido")

    user = read_user(user_id)
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Usuário inválido")

    return user


def get_optional_user(authorization: Optional[str] = Header(default=None)) -> Optional[Dict[str, Any]]:
    token = get_bearer_token(authorization)
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = str(payload.get("sub") or "").strip()
        if not user_id:
            return None
        return read_user(user_id)
    except Exception:
        return None


def ensure_developer(user: Dict[str, Any]) -> None:
    if normalize_role(str(user.get("role") or "usuario")) != "desenvolvedor":
        raise HTTPException(status_code=403, detail="Apenas desenvolvedor pode executar essa acao")


def resolve_user_id_by_identifier(identifier: str, email_idx: Dict[str, str], phone_idx: Dict[str, str]) -> Optional[str]:
    normalized_email = normalize_email(identifier)
    user_id = email_idx.get(normalized_email)
    if user_id:
        return user_id

    normalized_phone = normalize_phone(identifier)
    if normalized_phone:
        # Compatibilidade: aceita telefone com ou sem DDI 55 na recuperação.
        if len(normalized_phone) in (10, 11):
            normalized_phone = "55" + normalized_phone
        return phone_idx.get(normalized_phone)
    return None


def generate_password_reset_code() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(PASSWORD_RESET_CODE_LENGTH))


def build_password_reset_link(email: str, code: str) -> str:
    base = AUTH_PASSWORD_RESET_PAGE_URL or "https://jeffibr.github.io/Service/reset-password.html"
    query = urlencode({
        "mode": "signin",
        "recover": "1",
        "recover_email": email,
        "recover_code": code,
    })
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}{query}"


def is_brevo_configured() -> bool:
    return bool(BREVO_API_KEY and BREVO_SENDER_EMAIL and BREVO_API_BASE)


def send_password_reset_email(to_email: str, to_name: str, code: str, reset_link: str) -> None:
    if not is_brevo_configured():
        raise RuntimeError("Brevo não configurado")

    ttl_minutes = max(1, int(PASSWORD_RESET_TTL_SECONDS / 60))
    safe_name = (to_name or "Usuário").strip()
    html_content = f"""
      <html>
        <body style="font-family:Arial,sans-serif;background:#0b0c10;color:#f4f4f5;padding:20px;">
          <div style="max-width:520px;margin:0 auto;background:#151821;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:20px;">
            <h2 style="margin:0 0 12px;">Recuperação de senha</h2>
            <p style="margin:0 0 10px;">Olá, {safe_name}.</p>
            <p style="margin:0 0 10px;">Use o código abaixo para redefinir sua senha:</p>
            <div style="font-size:28px;font-weight:800;letter-spacing:4px;background:#0f1118;border:1px dashed #fbbf24;border-radius:10px;padding:14px;text-align:center;color:#fbbf24;">
              {code}
            </div>
            <p style="margin:14px 0 8px;">Ou clique no botão abaixo para abrir a tela de redefinição:</p>
            <p style="margin:0 0 8px;">
              <a href="{reset_link}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#fbbf24;color:#111;text-decoration:none;font-weight:800;">Redefinir senha</a>
            </p>
            <p style="margin:6px 0 0;color:#a1a1aa;font-size:12px;word-break:break-all;">Link: {reset_link}</p>
            <p style="margin:14px 0 0;color:#a1a1aa;">Este código expira em aproximadamente {ttl_minutes} minuto(s).</p>
            <p style="margin:8px 0 0;color:#a1a1aa;">Se você não solicitou esta alteração, ignore este e-mail.</p>
          </div>
        </body>
      </html>
    """

    payload = {
        "sender": {"email": BREVO_SENDER_EMAIL, "name": BREVO_SENDER_NAME},
        "to": [{"email": to_email, "name": safe_name}],
        "subject": "Código de recuperação de senha - Preço Certo",
        "htmlContent": html_content,
    }

    response = requests.post(
        f"{BREVO_API_BASE}/v3/smtp/email",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": BREVO_API_KEY,
        },
        json=payload,
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Falha ao enviar e-mail Brevo: {response.status_code} - {response.text}")


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "name": "Preco Certo FastAPI Auth",
        "status": "online",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "timestamp": now_iso(),
        "github_configured": storage.is_configured(),
    }


@app.post("/auth/register")
def register(payload: RegisterInput) -> Dict[str, Any]:
    if not storage.is_configured():
        raise HTTPException(status_code=500, detail="GitHub Storage não configurado")

    role = "usuario"

    email = normalize_email(str(payload.email))
    phone = normalize_phone(payload.telefone)
    if len(phone) in (10, 11):
        phone = "55" + phone
    if not phone.startswith("55") or len(phone) not in (12, 13):
        raise HTTPException(status_code=400, detail="Telefone inválido. Use formato brasileiro com DDD")

    sex = normalize_sex(payload.sexo)
    cep = normalize_phone(payload.cep or "")
    if len(cep) != 8:
        raise HTTPException(status_code=400, detail="CEP inválido")

    estado = (payload.estado or "").strip().upper()
    if len(estado) != 2:
        raise HTTPException(status_code=400, detail="Estado inválido. Use UF com 2 letras")

    email_idx, phone_idx, email_sha, phone_sha = load_indexes()

    if email in email_idx:
        raise HTTPException(status_code=409, detail="E-mail ja cadastrado")
    if phone in phone_idx:
        raise HTTPException(status_code=409, detail="Telefone ja cadastrado")

    user_id = uuid.uuid4().hex[:18]
    pwd = hash_password(payload.senha)
    ts = now_iso()

    user = {
        "id": user_id,
        "name": payload.nome.strip(),
        "email": email,
        "phone": phone,
        "image_url": "",
        "address": payload.endereco.strip(),
        "cep": cep,
        "street": (payload.rua or "").strip(),
        "number": (payload.numero or "").strip(),
        "city": (payload.cidade or "").strip(),
        "state": estado,
        "sex": sex,
        "role": role,
        "password": pwd,
        "created_at": ts,
        "updated_at": ts,
        "active": True,
    }

    write_user(user, message=f"Criar usuario {user_id}")

    email_idx[email] = user_id
    phone_idx[phone] = user_id
    storage.write_json(EMAIL_INDEX_PATH, email_idx, f"Atualizar indice de email ({email})", sha=email_sha)
    storage.write_json(PHONE_INDEX_PATH, phone_idx, f"Atualizar indice de telefone ({phone})", sha=phone_sha)

    return {
        "success": True,
        "data": {
            "user": sanitize_user_output(user),
            "allowed_pages": get_allowed_pages_for_user(user),
        },
    }


@app.post("/auth/login")
def login(payload: LoginInput) -> Dict[str, Any]:
    if not storage.is_configured():
        raise HTTPException(status_code=500, detail="GitHub Storage não configurado")

    identifier = payload.identifier.strip().lower()
    if not identifier:
        raise HTTPException(status_code=400, detail="Informe e-mail ou telefone")

    email_idx, phone_idx, _, _ = load_indexes()

    user_id = resolve_user_id_by_identifier(identifier, email_idx, phone_idx)

    if not user_id:
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    user = read_user(user_id)
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    if not verify_password(payload.password, user.get("password", {})):
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    now_ts = int(time.time())
    exp = now_ts + TOKEN_TTL_SECONDS
    token = create_token({
        "sub": user_id,
        "role": normalize_role(str(user.get("role") or "usuario")),
        "email": user.get("email"),
        "iat": now_ts,
        "exp": exp,
    })

    return {
        "success": True,
        "data": {
            "token": token,
            "expires_in": TOKEN_TTL_SECONDS,
            "user": sanitize_user_output(user),
            "allowed_pages": get_allowed_pages_for_user(user),
        },
    }


@app.post("/auth/password/forgot")
def forgot_password(payload: ForgotPasswordInput) -> Dict[str, Any]:
    if not storage.is_configured():
        raise HTTPException(status_code=500, detail="GitHub Storage não configurado")

    email = normalize_email(str(payload.email or "").strip())
    if not email and payload.identifier:
        email = normalize_email(str(payload.identifier or "").strip())
    if not email:
        raise HTTPException(status_code=400, detail="Informe o e-mail cadastrado")

    email_idx, _, _, _ = load_indexes()
    user_id = email_idx.get(email)
    exposed_code: Optional[str] = None

    if user_id:
        user = read_user(user_id)
        if user and user.get("active", True):
            reset_code = generate_password_reset_code()
            reset_link = build_password_reset_link(normalize_email(str(user.get("email") or email)), reset_code)
            user["password_reset"] = {
                "code": hash_password(reset_code),
                "expires_at": int(time.time()) + PASSWORD_RESET_TTL_SECONDS,
                "requested_at": now_iso(),
            }
            user["updated_at"] = now_iso()
            write_user(user, message=f"Gerar codigo de recuperacao de senha para usuario {user_id}")
            print(f"[AUTH] Código de recuperação para {user.get('email') or user.get('phone') or user_id}: {reset_code}")
            try:
                user_email = normalize_email(str(user.get("email") or ""))
                if user_email:
                    send_password_reset_email(user_email, str(user.get("name") or "Usuário"), reset_code, reset_link)
                    print(f"[AUTH] E-mail de recuperação enviado via Brevo para {user_email}")
            except Exception as mail_err:
                print(f"[AUTH] Falha no envio Brevo: {mail_err}")
            if PASSWORD_RESET_EXPOSE_CODE:
                exposed_code = reset_code

    data: Dict[str, Any] = {
        "message": "Se o usuário existir, um código de recuperação foi gerado.",
        "expires_in": PASSWORD_RESET_TTL_SECONDS,
    }
    if exposed_code:
        data["reset_code"] = exposed_code
    return {"success": True, "data": data}


@app.post("/auth/password/reset")
def reset_password(payload: ResetPasswordInput) -> Dict[str, Any]:
    if not storage.is_configured():
        raise HTTPException(status_code=500, detail="GitHub Storage não configurado")

    identifier = str(payload.identifier or "").strip()
    code = normalize_phone(str(payload.code or "").strip())
    new_password = str(payload.new_password or "")
    if not identifier:
        raise HTTPException(status_code=400, detail="Informe e-mail ou telefone")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter no minimo 6 caracteres")

    email_idx, phone_idx, _, _ = load_indexes()
    user_id = resolve_user_id_by_identifier(identifier, email_idx, phone_idx)
    if not user_id:
        raise HTTPException(status_code=400, detail="Código inválido ou expirado")

    user = read_user(user_id)
    if not user or not user.get("active", True):
        raise HTTPException(status_code=400, detail="Código inválido ou expirado")

    reset_data = user.get("password_reset", {})
    if not isinstance(reset_data, dict):
        raise HTTPException(status_code=400, detail="Código inválido ou expirado")

    expires_at = int(reset_data.get("expires_at", 0) or 0)
    if expires_at <= int(time.time()):
        raise HTTPException(status_code=400, detail="Código inválido ou expirado")

    code_data = reset_data.get("code", {})
    if not isinstance(code_data, dict) or not verify_password(code, code_data):
        raise HTTPException(status_code=400, detail="Código inválido ou expirado")

    user["password"] = hash_password(new_password)
    user.pop("password_reset", None)
    user["updated_at"] = now_iso()
    write_user(user, message=f"Redefinir senha por recuperação para usuario {user_id}")

    return {"success": True, "data": {"message": "Senha redefinida com sucesso. Faça login com a nova senha."}}


@app.get("/auth/me")
def me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return {
        "success": True,
        "data": {
            "user": sanitize_user_output(user),
            "allowed_pages": get_allowed_pages_for_user(user),
        },
    }


@app.patch("/auth/me")
def update_me(payload: UserUpdateInput, current: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = str(current.get("id"))
    if not user_id:
        raise HTTPException(status_code=401, detail="Usuário inválido")

    target_user = read_user(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    email_idx, phone_idx, email_sha, phone_sha = load_indexes()
    old_email = normalize_email(str(target_user.get("email") or ""))
    old_phone = normalize_phone(str(target_user.get("phone") or ""))

    if payload.nome is not None:
        nome = payload.nome.strip()
        if len(nome) < 2:
            raise HTTPException(status_code=400, detail="Nome inválido")
        target_user["name"] = nome

    if payload.email is not None:
        new_email = normalize_email(str(payload.email))
        if new_email != old_email:
            if new_email in email_idx and email_idx[new_email] != user_id:
                raise HTTPException(status_code=409, detail="E-mail ja cadastrado")
            if old_email in email_idx:
                email_idx.pop(old_email, None)
            email_idx[new_email] = user_id
            target_user["email"] = new_email
            old_email = new_email

    if payload.telefone is not None:
        new_phone = normalize_phone(payload.telefone)
        if len(new_phone) in (10, 11):
            new_phone = "55" + new_phone
        if not new_phone.startswith("55") or len(new_phone) not in (12, 13):
            raise HTTPException(status_code=400, detail="Telefone inválido. Use formato brasileiro com DDD")
        if new_phone != old_phone:
            if new_phone in phone_idx and phone_idx[new_phone] != user_id:
                raise HTTPException(status_code=409, detail="Telefone ja cadastrado")
            if old_phone in phone_idx:
                phone_idx.pop(old_phone, None)
            phone_idx[new_phone] = user_id
            target_user["phone"] = new_phone
            old_phone = new_phone

    if payload.endereco is not None:
        endereco = payload.endereco.strip()
        if len(endereco) < 3:
            raise HTTPException(status_code=400, detail="Endereço inválido")
        target_user["address"] = endereco

    if payload.sexo is not None:
        target_user["sex"] = normalize_sex(payload.sexo)

    if payload.cep is not None:
        cep = normalize_phone(payload.cep)
        if len(cep) != 8:
            raise HTTPException(status_code=400, detail="CEP inválido")
        target_user["cep"] = cep

    if payload.rua is not None:
        target_user["street"] = payload.rua.strip()

    if payload.numero is not None:
        target_user["number"] = payload.numero.strip()

    if payload.cidade is not None:
        target_user["city"] = payload.cidade.strip()

    if payload.estado is not None:
        uf = payload.estado.strip().upper()
        if uf and len(uf) != 2:
            raise HTTPException(status_code=400, detail="Estado inválido. Use UF com 2 letras")
        target_user["state"] = uf

    if payload.image_url is not None:
        image_url = str(payload.image_url).strip()
        if image_url and not image_url.startswith("data:image/") and not image_url.startswith("http"):
            raise HTTPException(status_code=400, detail="Formato de imagem inválido")
        target_user["image_url"] = image_url

    # Troca de senha do proprio usuario (exige senha atual)
    if payload.senha_nova is not None:
        senha_nova = str(payload.senha_nova or "")
        senha_atual = str(payload.senha_atual or "")

        if len(senha_nova) < 6:
            raise HTTPException(status_code=400, detail="A nova senha deve ter no minimo 6 caracteres")
        if not senha_atual:
            raise HTTPException(status_code=400, detail="Informe a senha atual para alterar a senha")
        if not verify_password(senha_atual, target_user.get("password", {})):
            raise HTTPException(status_code=401, detail="Senha atual incorreta")

        target_user["password"] = hash_password(senha_nova)
        target_user.pop("password_reset", None)

    target_user["updated_at"] = now_iso()
    write_user(target_user, message=f"Atualizar perfil do usuario {user_id}")
    storage.write_json(EMAIL_INDEX_PATH, email_idx, "Atualizar indice de email", sha=email_sha)
    storage.write_json(PHONE_INDEX_PATH, phone_idx, "Atualizar indice de telefone", sha=phone_sha)

    return {
        "success": True,
        "data": {
            "user": sanitize_user_output(target_user),
            "allowed_pages": get_allowed_pages_for_user(target_user),
        },
    }


@app.get("/auth/users")
def list_users(current: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    ensure_developer(current)

    email_idx, _, _, _ = load_indexes()
    users: List[Dict[str, Any]] = []

    for _, user_id in email_idx.items():
        user = read_user(user_id)
        if user:
            users.append(sanitize_user_output(user))

    users.sort(key=lambda u: str(u.get("created_at") or ""), reverse=True)
    return {"success": True, "data": users}


@app.get("/auth/permissions")
def get_permissions(current: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    ensure_developer(current)
    return {"success": True, "data": load_group_pages()}


@app.put("/auth/permissions/{role}")
def set_role_permissions(role: str, payload: GroupPagesInput, current: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    ensure_developer(current)

    target_role = normalize_role(role)
    pages = [str(p).strip() for p in payload.pages if str(p).strip()]
    if not pages:
        raise HTTPException(status_code=400, detail="Informe pelo menos uma pagina")

    pages = sorted(set(pages))

    current_cfg, sha = ensure_json_file(GROUP_PAGES_PATH, DEFAULT_GROUP_PAGES)
    if not isinstance(current_cfg, dict):
        current_cfg = dict(DEFAULT_GROUP_PAGES)

    current_cfg[target_role] = pages
    storage.write_json(GROUP_PAGES_PATH, current_cfg, f"Atualizar permissoes do grupo {target_role}", sha=sha)

    return {"success": True, "data": current_cfg}


@app.post("/auth/users/{user_id}/role")
def update_user_role(user_id: str, role: str, current: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    ensure_developer(current)

    target_user = read_user(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    target_user["role"] = normalize_role(role)
    target_user["updated_at"] = now_iso()
    write_user(target_user, message=f"Atualizar role do usuario {user_id}")

    return {
        "success": True,
        "data": {
            "user": sanitize_user_output(target_user),
            "allowed_pages": get_allowed_pages_for_user(target_user),
        },
    }


@app.patch("/auth/users/{user_id}")
def update_user(user_id: str, payload: UserUpdateInput, current: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    ensure_developer(current)

    target_user = read_user(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    email_idx, phone_idx, email_sha, phone_sha = load_indexes()
    old_email = normalize_email(str(target_user.get("email") or ""))
    old_phone = normalize_phone(str(target_user.get("phone") or ""))

    if payload.nome is not None:
        nome = payload.nome.strip()
        if len(nome) < 2:
            raise HTTPException(status_code=400, detail="Nome inválido")
        target_user["name"] = nome

    if payload.email is not None:
        new_email = normalize_email(str(payload.email))
        if new_email != old_email:
            if new_email in email_idx and email_idx[new_email] != user_id:
                raise HTTPException(status_code=409, detail="E-mail ja cadastrado")
            if old_email in email_idx:
                email_idx.pop(old_email, None)
            email_idx[new_email] = user_id
            target_user["email"] = new_email
            old_email = new_email

    if payload.telefone is not None:
        new_phone = normalize_phone(payload.telefone)
        if len(new_phone) in (10, 11):
            new_phone = "55" + new_phone
        if not new_phone.startswith("55") or len(new_phone) not in (12, 13):
            raise HTTPException(status_code=400, detail="Telefone inválido. Use formato brasileiro com DDD")

        if new_phone != old_phone:
            if new_phone in phone_idx and phone_idx[new_phone] != user_id:
                raise HTTPException(status_code=409, detail="Telefone ja cadastrado")
            if old_phone in phone_idx:
                phone_idx.pop(old_phone, None)
            phone_idx[new_phone] = user_id
            target_user["phone"] = new_phone
            old_phone = new_phone

    if payload.endereco is not None:
        endereco = payload.endereco.strip()
        if len(endereco) < 3:
            raise HTTPException(status_code=400, detail="Endereço inválido")
        target_user["address"] = endereco

    if payload.sexo is not None:
        target_user["sex"] = normalize_sex(payload.sexo)

    if payload.cep is not None:
        cep = normalize_phone(payload.cep)
        if len(cep) != 8:
            raise HTTPException(status_code=400, detail="CEP inválido")
        target_user["cep"] = cep

    if payload.rua is not None:
        target_user["street"] = payload.rua.strip()

    if payload.numero is not None:
        target_user["number"] = payload.numero.strip()

    if payload.cidade is not None:
        target_user["city"] = payload.cidade.strip()

    if payload.estado is not None:
        uf = payload.estado.strip().upper()
        if uf and len(uf) != 2:
            raise HTTPException(status_code=400, detail="Estado inválido. Use UF com 2 letras")
        target_user["state"] = uf

    if payload.active is not None:
        target_user["active"] = bool(payload.active)

    target_user["updated_at"] = now_iso()
    write_user(target_user, message=f"Atualizar dados do usuario {user_id}")

    storage.write_json(EMAIL_INDEX_PATH, email_idx, "Atualizar indice de email", sha=email_sha)
    storage.write_json(PHONE_INDEX_PATH, phone_idx, "Atualizar indice de telefone", sha=phone_sha)

    return {
        "success": True,
        "data": {
            "user": sanitize_user_output(target_user),
            "allowed_pages": get_allowed_pages_for_user(target_user),
        },
    }

