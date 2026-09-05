# MetalLB Speaker — "DNSConfigForming: Nameserver limits were exceeded" — ရှင်းလင်းချက်နဲ့ ဖြေရှင်းနည်း

## ဘာဖြစ်နေတာလဲ

```
DNSConfigForming  Pod speaker-2d8wg  Nameserver limits were exceeded, some nameservers
                  have been omitted, the applied nameserver line is:
                  10.10.10.10 10.10.10.10 10.10.10.10 10.10.10.10 10.10.10.10
```

**Kernel ရဲ့ hard limit:** Linux node တစ်ခုရဲ့ `/etc/resolv.conf` မှာ nameserver **အများဆုံး 3 လုံး** သာ ထားနိုင်တယ် (MAXNS = 3, glibc limit)။

**မင်းရဲ့ node ရဲ့ resolv.conf မှာ 10.10.10.10 ကို 5 ကြိမ် (duplicate) ပါနေတယ်** — node networking config မှာ DNS server တစ်လုံးတည်းကို 5 ကြိမ် ထည့်ထားလို့ kernel က 3 လုံး ပဲ ယူပြီး ကျန် 2 လုံးကို omit လုပ်တယ်။ Kubernetes kubelet က node ရဲ့ resolv.conf ကို pod တွေဆီ ကူးပေးတဲ့အခါ ဒီ warning ကို မှတ်တမ်းတင်လိုက်တာ။

## အန္တရာယ် ရှိလား?

**MetalLB speaker အတွက် — မရှိပါဘူး** ✅
- Speaker က **L2/ARP announcement** လုပ်တာပဲ ရှိတယ် — DNS lookup လုံးဝ မသုံးဘူး
- Pods တွေ Running ဖြစ်နေတယ် (1/1, 18d uptime) — ဘာမှ ထိခိုက်မနေဘူး

**အခြား workloads အတွက် — အနည်းငယ် စိတ်ပူစရာရှိတယ်** ⚠️
- Duplicate nameserver တွေက **DNS timeout cascade** ဖြစ်စေနိုင်တယ် (3 nameserver limit ကြောင့် backup servers မရှိဘူး ဆိုတဲ့ သဘော)
- node-local DNS မမှန်ရင် image pull, external API calls ပိုကြားနိုင်တယ်

## အမြစ်ကို ဖြေရှင်းရန် — Node ရဲ့ resolv.conf ပြင်ပါ

ဒါက **node-level (OS-level)** ပြဿနာ ဖြစ်ပြီး Kubernetes manifests နဲ့ မငြိစပ်ဘူး။ SSH ဝင်ပြီး:

### 1) လက်ရှိ အခြေအနေ စစ်
```bash
# node တစ်ခုစီမှာ
cat /etc/resolv.conf
# မျှော်မှန်းရလဒ်:
#   nameserver 10.10.10.10
#   nameserver 10.10.10.10     ← duplicate!
#   nameserver 10.10.10.10     ← duplicate!
#   ...
```

### 2) အကြောင်းရင်း ရှာ — netplan ဟာလား systemd-resolved ဟာလား

**Ubuntu (netplan) ဆိုရင်:**
```bash
cat /etc/netplan/*.yaml
# nameservers: addresses: [10.10.10.10, 10.10.10.10, ...]  — duplicates ရှာ
```

ပြင်ပြီး:
```bash
sudo netplan apply
```

**systemd-resolved ဆိုရင်** (upstream duplicates):
```bash
resolvectl status | grep "DNS Servers" -A 2
# duplicates မြင်ရရင် /etc/systemd/resolved.conf မှာ:
#   DNS=10.10.10.10
# (တစ်လုံးတည်းသာ) ထည့်ပြီး:
sudo systemctl restart systemd-resolved
```

### 3) Node တစ်ခုလုံး ansible/cloud-init နဲ့ စီမံထားရင်
Inventory ထဲက `dns_nameservers` list ကို dedupe လုပ်ပါ — ဥပမာ:
```yaml
dns_nameservers: ["10.10.10.10", "8.8.8.8"]   # 3 လုံးအောက်, no duplicates
```

### 4) RKE2-specific
RKE2 agent က node resolv.conf ကို `/var/lib/rancher/rke2/agent/etc/resolv.conf` မှာ copy သုံးတယ် —
node-level ပြင်ပြီးရင် **kubelet restart** (သို့) node reboot လုပ်ရင် auto-clean ဖြစ်သွားမယ်:
```bash
sudo systemctl restart rke2-agent   # worker
sudo systemctl restart rke2-server  # server
```

## အတည်ပြုချက်

ပြင်ပြီးနောက် 5-10 မိနစ်အတွင်း speaker pods restart လုပ်လိုက်ရင် warning ပျောက်သွားမယ်:
```bash
kubectl -n metallb-system rollout restart ds/speaker
kubectl -n metallb-system logs -l component=speaker --tail=50 | grep -i "nameserver"
# (empty = fixed)
```

## အနှစ်ချုပ်

| အချက် | အဖြေ |
|---|---|
| ဘာလဲ | Node resolv.conf ထဲ nameserver 10.10.10.10 ကို 5 ခါ duplicate ထား (limit 3) |
| ထိခိုက်လား | MetalLB ကို မထိခိုက် (announce-only); DNS resilience အတွက် ပြင်သင့် |
| ဘယ်နေရာမှာ ပြင်မလဲ | **Node OS level** (netplan / systemd-resolved / cloud-init) — K8s မဟုတ် |
| ပြင်ပြီးရင် | kubelet/rke2 restart သို့ node reboot; warning auto-clear |
