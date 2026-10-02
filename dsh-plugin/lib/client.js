window.__ModuleLoader__.load({
	id: "dsh-plugin-whale-pet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const slots = require("@deepseek-ai/dsh-client-ui-slots");

		const NS = "whale-pet";
		const RPC = "/whale-pet/rpc";

		/** 调 Host 半边。 */
		async function callHost(method, args) {
			const res = await fetch(RPC, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ method, args }),
			});
			if (!res.ok) throw new Error(`whale-pet rpc HTTP ${res.status}`);
			return res.json();
		}

		/** 侧边栏底部按钮：打开/关闭桌宠面板。 */
		function WhalePetButton(props) {
			const [open, setOpen] = React.useState(false);
			const [status, setStatus] = React.useState({ running: false });
			const [balance, setBalance] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);

			// 打开时轮询状态。
			React.useEffect(() => {
				if (!open) return;
				let alive = true;
				const tick = async () => {
					try {
						const s = await callHost("status");
						if (alive) { setStatus(s); setError(s.error ?? null); }
					} catch (e) {
						if (alive) setError(String(e.message || e));
					}
				};
				tick();
				const id = setInterval(tick, 3000);
				return () => { alive = false; clearInterval(id); };
			}, [open]);

			const toggle = async () => {
				setBusy(true); setError(null);
				try {
					const r = await callHost(status.running ? "stop" : "start");
					if (r && r.ok === false) setError(r.error);
					const s = await callHost("status");
					setStatus(s);
				} catch (e) {
					setError(String(e.message || e));
				} finally { setBusy(false); }
			};

			const checkBalance = async () => {
				setBusy(true); setError(null);
				try {
					const b = await callHost("balance");
					setBalance(b);
					if (b && b.ok === false) setError(b.error);
				} catch (e) { setError(String(e.message || e)); }
				finally { setBusy(false); }
			};

			const label = "🐋 虎鲸桌宠";

			// 关闭状态：只画一个可点的按钮。
			if (!open) {
				return React.createElement("button", {
					type: "button",
					onClick: () => setOpen(true),
					title: label,
					style: {
						display: "flex", alignItems: "center", gap: "8px",
						width: "100%", padding: "8px 10px", margin: "2px 0",
						background: "transparent", border: "none", borderRadius: "12px",
						color: "var(--dsw-alias-label-primary, inherit)",
						font: "inherit", fontSize: "14px", cursor: "pointer", textAlign: "left",
					},
				}, label);
			}

			const money = balance && balance.ok
				? `${balance.currency === "USD" ? "$" : "¥"}${Number(balance.total).toFixed(2)}`
				: null;
			const low = balance && balance.ok && balance.total < 1;

			const row = (children) => React.createElement("div", {
				style: { display: "flex", alignItems: "center", gap: "8px", margin: "6px 0" },
			}, children);

			const btn = (text, onClick, danger) => React.createElement("button", {
				type: "button",
				onClick,
				disabled: busy,
				style: {
					padding: "5px 12px", borderRadius: "8px", cursor: busy ? "default" : "pointer",
					border: "1px solid var(--dsw-alias-border-l2, #444)",
					background: danger ? "var(--dsw-alias-bg-danger, #5a1f1f)" : "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08))",
					color: "var(--dsw-alias-label-primary, inherit)",
					font: "inherit", fontSize: "13px", opacity: busy ? 0.6 : 1,
				},
			}, text);

			return React.createElement("div", {
				style: {
					position: "fixed", right: "20px", bottom: "20px", zIndex: 9999,
					width: "260px", padding: "14px 16px", borderRadius: "16px",
					background: "var(--dsw-alias-bg-layer-2, #1e1e24)",
					boxShadow: "var(--dsw-elevation-prominent, 0 8px 32px rgba(0,0,0,.45))",
					color: "var(--dsw-alias-label-primary, #eee)",
					font: "inherit", fontSize: "14px",
				},
			},
				row([
					React.createElement("strong", { key: "t", style: { flex: 1 } }, label),
					btn("✕", () => setOpen(false)),
				]),
				row([
					React.createElement("span", { key: "s", style: { flex: 1 } },
						status.running ? "🟢 运行中" : "⚪ 未启动"),
					btn(status.running ? "关闭" : "启动", toggle),
				]),
				row([
					React.createElement("span", { key: "b", style: { flex: 1 } },
						money ? `${low ? "⚡ " : "💰 "}余额 ${money}` : "💰 未查询"),
					btn("查余额", checkBalance),
				]),
				low ? React.createElement("div", {
					style: { color: "#f0a020", fontSize: "12px", marginTop: "4px" },
				}, "⚡ 余额偏低，记得充值") : null,
				error ? React.createElement("div", {
					style: { color: "#ff6b6b", fontSize: "12px", marginTop: "6px", wordBreak: "break-all" },
				}, error) : null,
			);
		}

		/** 注册到侧边栏底部的动作区。 */
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "whale-pet",
				order: 100,
				label: () => "🐋 虎鲸桌宠",
			}, WhalePetButton));
		}

		const inject = ["slots"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});