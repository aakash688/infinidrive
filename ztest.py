import requests

url = "https://vingai.vercel.app/api/generate"

payload = {
    "prompt": (
        "woman, with is applying lipstick on her lips in seductive way cinematic expression, "
        "wearing sexy one peice, with statement earrings only, architectural, in interior, "
        "(romatic), lit by cinematic lighting, with cinematic lighting quality, "
        "shot from over-the-shoulder from behind, using 135mm telephoto, "
        "conveying tension and urban alienation, with cigarette smoke curling, "
        "camera: orbit around subject, subject action: turning to face camera, "
        "frozen moment with subtle movement"
    ),
    "duration": 8,
    "aspectRatio": "16:9"
}

headers = {
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Origin": "https://vingai.vercel.app",
    "Referer": "https://vingai.vercel.app/dashboard",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/144.0.0.0 Safari/537.36"
    ),
    "X-CSRF-Token": "6eYGUN6k-kPdOWqkdnLS7Dw9wuqa6DwANVLo"
}

cookies = {
    "sb-jyeqrdiczzljrrnlfhlx-auth-token": (
        "base64-eyJhY2Nlc3NfdG9rZW4iOiJleUpoYkdjaU9pSkZVekkxTmlJc0ltdHBaQ0k2SW1ZME1HSmlPV0Zp"
        "TFRobFpHWXRORE01TVMxaU5HWTBMV1ZqTWpsa01UQXlObVJsWkNJc0luUjVjQ0k2SWtwWFZDSjkuZXlK"
        "cGMzTWlPaUpvZEhSd2N6b3ZMMnA1WlhGeVpHbGplbnBzYW5KeWJteG1hR3g0TG5OMWNHRmlZWE5sTG1O"
        "dkwyRjFkR2d2ZGpFaUxDSnpkV0lpT2lKaE5HWXlaVGswWXkwNE56STBMVFExTm1RdE9ESTRZUzA0T1dG"
        "aU5qWmlNRGhpWldFaUxDSmhkV1FpT2lKaGRYUm9aVzUwYVdOaGRHVmtJaXdpWlhod0lqb3hOemN3TmpJ"
        "Mk5qUTNMQ0pwWVhRaU9qRTNOekEyTWpNd05EY3NJbVZ0WVdsc0lqb2laR1ZrWVdJNU9EUXhNa0JvWld4"
        "bGMyTnZMbU52YlNJc0luQm9iMjVsSWpvaUlpd2lZWEJ3WDIxbGRHRmtZWFJoSWpwN0luQnliM1pwWkdW"
        "eUlqb2laVzFoYVd3aUxDSndjbTkyYVdSbGNuTWlPbHNpWlcxaGFXd2lYWDBzSW5WelpYSmZiV1YwWVdS"
        "aGRHRWlPbnNpWlcxaGFXd2lPaUprWldSaFlqazROREV5UUdobGJHVnpZMjh1WTI5dElpd2laVzFoYVd4"
        "ZmRtVnlhV1pwWldRaU9uUnlkV1VzSW5Cb2IyNWxYM1psY21sbWFXVmtJanBtWVd4elpTd2ljM1ZpSWpv"
        "aVlUUm1NbVU1TkdNdE9EY3lOQzAwTlRaa0xUZ3lPR0V0T0RsaFlqWTJZakE0WW1WaEluMHNJbkp2YkdV"
        "aU9pSmhkWFJvWlc1MGFXTmhkR1ZrSWl3aVlXRnNJam9pWVdGc01TSXNJbUZ0Y2lJNlczc2liV1YwYUc5"
        "a0lqb2laVzFoYVd3dmMybG5iblZ3SWl3aWRHbHRaWE4wWVcxd0lqb3hOemN3TmpJek1EUTNmVjBzSW5O"
        "bGMzTnBiMjVmYVdRaU9pSTJOV0U1TTJOaU9DMDNOakl4TFRSaU16Y3RPVEUzWVMxaVl6WmhOVGMwT1dS"
        "bFpUWWlMQ0pwYzE5aGJtOXVlVzF2ZFhNaU9tWmhiSE5sZlEuWFhCUG5uYWk5aTZfVnNySnFBODR4UnNq"
        "SGcxYVF0UnBSTEFIaWhENmU0ZExhc2xFaXVxT1lHdHdpNksyZkVBS0l6V3RZTkpRb2NUdmdOb2x2aDZ5"
        "a0Ei"
    ),
    "csrf-token": "6eYGUN6k-kPdOWqkdnLS7Dw9wuqa6DwANVLo",
    "csrf-secret": "7RcNEf_-W4TG2iDYwOL0usHS"
}

response = requests.post(
    url,
    json=payload,
    headers=headers,
    cookies=cookies,
    timeout=60
)

print("Status Code:", response.status_code)

try:
    print("Response JSON:", response.json())
except ValueError:
    print("Response Text:", response.text)
